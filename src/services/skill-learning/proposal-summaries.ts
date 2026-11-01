import { countDiffLines } from "./line-diff.js";
import {
  PROPOSAL_ORDER,
  parseEvidenceIds,
  proposalFilterClause,
  type ProposalFilter,
  type SkillAppliedBy,
  type SkillDraftedBy,
  type SkillProposalKind,
  type SkillProposalState,
} from "./proposal-store.js";
import type { SkillStore } from "./store.js";

/**
 * Proposal lists without the proposed content or the diff (TDR-059). Those two
 * columns are the bulk of a proposal, so a list names its columns and reads
 * them only to count lines, and only for the proposals it returns. Nothing
 * here reads `CONFIG`.
 */

/** A proposal as a list shows it, before line counts. */
export interface SkillProposalRow {
  id: string;
  kind: SkillProposalKind;
  skillName: string;
  skillPath: string | null;
  state: SkillProposalState;
  appliedBy: SkillAppliedBy | null;
  draftedBy: SkillDraftedBy;
  summary: string | null;
  evidenceTurnIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface LineCounts {
  added: number;
  removed: number;
  /** False for a proposal with no diff, such as a new skill. */
  hasDiff: boolean;
}

/** A listed proposal: the row and its line counts. `withCanUndo` adds `canUndo`. */
export interface SkillProposalSummary extends SkillProposalRow, LineCounts {}

export interface ProposalPage {
  limit: number;
  offset: number;
}

type Row = Record<string, unknown>;

const LIST_COLUMNS =
  "id, kind, skill_name, skill_path, state, applied_by, drafted_by, summary, evidence_turn_ids, created_at, updated_at";

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toRow(row: Row): SkillProposalRow {
  return {
    id: String(row.id),
    kind: String(row.kind) as SkillProposalKind,
    skillName: String(row.skill_name),
    skillPath: text(row.skill_path),
    state: String(row.state) as SkillProposalState,
    appliedBy: text(row.applied_by) as SkillAppliedBy | null,
    draftedBy: row.drafted_by === "agent" ? "agent" : "model",
    summary: text(row.summary),
    evidenceTurnIds: parseEvidenceIds(row.evidence_turn_ids),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Proposals without content or diff, newest first. */
export async function listProposalRows(
  store: SkillStore,
  filter: ProposalFilter = {}
): Promise<SkillProposalRow[]> {
  const db = await store.existingDb();
  if (!db) return [];
  const { clause, args } = proposalFilterClause(filter);
  const rows = await db.all(
    `SELECT ${LIST_COLUMNS} FROM skill_proposals ${clause} ${PROPOSAL_ORDER}`,
    args
  );
  return rows.map(toRow);
}

/** Lines of a new skill's content. A blank body has none, as on the Skills page. */
function contentLines(content: string): number {
  return content.trim() ? content.split("\n").length : 0;
}

/**
 * Added and removed lines for the given proposal ids. Reads the diff, and the
 * content only where there is no diff. A proposal with no diff counts every
 * content line as added. Unknown ids are left out.
 */
export async function proposalLineCounts(
  store: SkillStore,
  ids: readonly string[]
): Promise<Map<string, LineCounts>> {
  const counts = new Map<string, LineCounts>();
  const db = await store.existingDb();
  if (!db || ids.length === 0) return counts;
  // The diff text is read here and counted in JavaScript. Counting inside SQLite was
  // measured 20 ms slower at 5,000 proposals, because `replace()` copies each diff.
  const rows = await db.all(
    `SELECT id, diff, CASE WHEN diff IS NULL THEN proposed_content END AS content
     FROM skill_proposals WHERE id IN (SELECT value FROM json_each(?))`,
    [JSON.stringify(ids)]
  );
  for (const row of rows) {
    const diff = text(row.diff);
    counts.set(
      String(row.id),
      diff === null
        ? { added: contentLines(String(row.content ?? "")), removed: 0, hasDiff: false }
        : { ...countDiffLines(diff), hasDiff: true }
    );
  }
  return counts;
}

/**
 * Summaries of the proposals that match the filter, newest first, with line
 * counts for the returned page only. `total` counts every match. Without a
 * page the whole list comes back.
 */
export async function listProposalSummaries(
  store: SkillStore,
  filter: ProposalFilter = {},
  page?: ProposalPage
): Promise<{ proposals: SkillProposalSummary[]; total: number }> {
  const all = await listProposalRows(store, filter);
  const shown = page ? all.slice(page.offset, page.offset + page.limit) : all;
  const counts = await proposalLineCounts(
    store,
    shown.map((p) => p.id)
  );
  return {
    proposals: shown.map((p) => ({
      ...p,
      ...(counts.get(p.id) ?? { added: 0, removed: 0, hasDiff: false }),
    })),
    total: all.length,
  };
}
