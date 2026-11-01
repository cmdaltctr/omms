import { randomUUID } from "node:crypto";
import { type SkillStore, SkillStoreError } from "./store.js";
import type { TursoDb } from "../turso/turso-db.js";

type Row = Record<string, unknown>;

/**
 * Proposals, saved versions and per-skill settings in `skills.db`. Built on the
 * `SkillStore` connection. Call `store.init()` before a write. Reads on a
 * missing file return empty values and do not create it.
 */

export type SkillProposalKind = "improve" | "new";
export type SkillProposalState = "pending" | "applied" | "stale" | "rejected" | "undone";
export type SkillAppliedBy = "person" | "agent" | "automatic";
/** `model`: the external API drafted it. `agent`: the coding agent wrote it through `propose`. */
export type SkillDraftedBy = "model" | "agent";
export type SkillMode = "manual" | "automatic";

export interface SkillProposal {
  id: string;
  kind: SkillProposalKind;
  skillName: string;
  /** Full path of the `SKILL.md` the proposal writes. */
  skillPath: string | null;
  /** sha256 of the file the draft started from; null for a new skill. */
  baseHash: string | null;
  content: string;
  diff: string | null;
  summary: string | null;
  evidenceTurnIds: number[];
  state: SkillProposalState;
  appliedBy: SkillAppliedBy | null;
  draftedBy: SkillDraftedBy;
  createdAt: number;
  updatedAt: number;
}

export interface NewSkillProposal {
  kind: SkillProposalKind;
  skillName: string;
  skillPath: string | null;
  baseHash: string | null;
  content: string;
  diff: string | null;
  summary: string | null;
  evidenceTurnIds: number[];
  /** Defaults to `model`. */
  draftedBy?: SkillDraftedBy;
}

export interface SkillVersion {
  id: number;
  proposalId: string;
  path: string;
  /** The file before the apply, or null when the apply created it. */
  previousContent: string | null;
  writtenHash: string;
  savedAt: number;
}

export interface SkillSettings {
  skillPath: string;
  mode: SkillMode;
  lastReviewAt: number | null;
  usesAtLastReview: number;
}

async function writableDb(store: SkillStore): Promise<TursoDb> {
  if (store.isReadOnly()) {
    throw new SkillStoreError("skills.db is from a newer OMMS and is read-only", "read_only");
  }
  return store.db();
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** The turn ids in an `evidence_turn_ids` column. A damaged list reads as no evidence. */
export function parseEvidenceIds(raw: unknown): number[] {
  try {
    const parsed: unknown = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.map(Number);
  } catch {
    // A damaged list reads as no evidence.
  }
  return [];
}

function toProposal(row: Row): SkillProposal {
  const evidence = parseEvidenceIds(row.evidence_turn_ids);
  return {
    id: String(row.id),
    kind: String(row.kind) as SkillProposalKind,
    skillName: String(row.skill_name),
    skillPath: text(row.skill_path),
    baseHash: text(row.base_hash),
    content: String(row.proposed_content),
    diff: text(row.diff),
    summary: text(row.summary),
    evidenceTurnIds: evidence,
    state: String(row.state) as SkillProposalState,
    appliedBy: text(row.applied_by) as SkillAppliedBy | null,
    draftedBy: row.drafted_by === "agent" ? "agent" : "model",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Saves a pending proposal with a new id. */
export async function createProposal(
  store: SkillStore,
  input: NewSkillProposal,
  now: number
): Promise<SkillProposal> {
  const db = await writableDb(store);
  const proposal: SkillProposal = {
    id: randomUUID(),
    ...input,
    draftedBy: input.draftedBy ?? "model",
    state: "pending",
    appliedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO skill_proposals
      (id, kind, skill_name, skill_path, base_hash, proposed_content, diff, summary,
       evidence_turn_ids, state, applied_by, drafted_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      proposal.id,
      proposal.kind,
      proposal.skillName,
      proposal.skillPath,
      proposal.baseHash,
      proposal.content,
      proposal.diff,
      proposal.summary,
      JSON.stringify(proposal.evidenceTurnIds),
      proposal.state,
      proposal.appliedBy,
      proposal.draftedBy,
      proposal.createdAt,
      proposal.updatedAt,
    ]
  );
  return proposal;
}

export async function getProposal(store: SkillStore, id: string): Promise<SkillProposal | null> {
  const db = await store.existingDb();
  if (!db) return null;
  const row = await db.get("SELECT * FROM skill_proposals WHERE id = ?", [id]);
  return row ? toProposal(row) : null;
}

export interface ProposalFilter {
  state?: SkillProposalState;
  skillName?: string;
  skillPath?: string;
}

/** The shared order of every proposal list: newest first, ties by insertion. */
export const PROPOSAL_ORDER = "ORDER BY created_at DESC, rowid DESC";

/** The `WHERE` clause and its arguments for a filter. Empty when the filter is empty. */
export function proposalFilterClause(filter: ProposalFilter): { clause: string; args: string[] } {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.state) {
    where.push("state = ?");
    args.push(filter.state);
  }
  if (filter.skillName) {
    where.push("skill_name = ?");
    args.push(filter.skillName);
  }
  if (filter.skillPath) {
    where.push("skill_path = ?");
    args.push(filter.skillPath);
  }
  return { clause: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", args };
}

/**
 * Sets the state and the update time. `appliedBy` is written when given and
 * kept otherwise. Returns false when no proposal has this id.
 */
export async function updateProposalState(
  store: SkillStore,
  id: string,
  state: SkillProposalState,
  now: number,
  appliedBy?: SkillAppliedBy
): Promise<boolean> {
  const db = await writableDb(store);
  const changed = await db.run(
    "UPDATE skill_proposals SET state = ?, applied_by = COALESCE(?, applied_by), updated_at = ? WHERE id = ?",
    [state, appliedBy ?? null, now, id]
  );
  return changed > 0;
}

/** Saves the content a write replaces. Returns the version id. */
export async function saveSkillVersion(
  store: SkillStore,
  version: Pick<SkillVersion, "proposalId" | "path" | "previousContent" | "writtenHash">,
  now: number
): Promise<number> {
  const db = await writableDb(store);
  const result = await db.execute(
    "INSERT INTO skill_versions (proposal_id, path, previous_content, written_hash, saved_at) VALUES (?, ?, ?, ?, ?)",
    [version.proposalId, version.path, version.previousContent, version.writtenHash, now]
  );
  return Number(result.lastInsertRowid);
}

/** Removes a version whose write did not happen. */
export async function deleteSkillVersion(store: SkillStore, id: number): Promise<void> {
  const db = await writableDb(store);
  await db.run("DELETE FROM skill_versions WHERE id = ?", [id]);
}

export async function getLatestVersion(
  store: SkillStore,
  proposalId: string
): Promise<SkillVersion | null> {
  const db = await store.existingDb();
  if (!db) return null;
  const row = await db.get(
    "SELECT * FROM skill_versions WHERE proposal_id = ? ORDER BY id DESC LIMIT 1",
    [proposalId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    proposalId: String(row.proposal_id),
    path: String(row.path),
    previousContent: text(row.previous_content),
    writtenHash: String(row.written_hash),
    savedAt: Number(row.saved_at),
  };
}

/** The settings for one skill. A skill with no row is in manual mode and never reviewed. */
export async function getSkillSettings(
  store: SkillStore,
  skillPath: string
): Promise<SkillSettings> {
  const db = await store.existingDb();
  const row = db
    ? await db.get("SELECT * FROM skill_settings WHERE skill_path = ?", [skillPath])
    : null;
  return {
    skillPath,
    mode: row?.mode === "automatic" ? "automatic" : "manual",
    lastReviewAt: row?.last_review_at == null ? null : Number(row.last_review_at),
    usesAtLastReview: Number(row?.uses_at_last_review ?? 0),
  };
}

export async function setSkillMode(
  store: SkillStore,
  skillPath: string,
  mode: SkillMode
): Promise<void> {
  const db = await writableDb(store);
  await db.run(
    `INSERT INTO skill_settings (skill_path, mode) VALUES (?, ?)
     ON CONFLICT(skill_path) DO UPDATE SET mode = excluded.mode`,
    [skillPath, mode]
  );
}

/** Records a review: its time and the use count at that time. */
export async function setSkillReview(
  store: SkillStore,
  skillPath: string,
  reviewedAt: number,
  uses: number
): Promise<void> {
  const db = await writableDb(store);
  await db.run(
    `INSERT INTO skill_settings (skill_path, mode, last_review_at, uses_at_last_review)
     VALUES (?, 'manual', ?, ?)
     ON CONFLICT(skill_path) DO UPDATE SET
       last_review_at = excluded.last_review_at,
       uses_at_last_review = excluded.uses_at_last_review`,
    [skillPath, reviewedAt, uses]
  );
}
