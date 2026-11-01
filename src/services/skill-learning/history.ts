import { checkUndo, type ApplyDeps } from "./apply.js";
import { countDiffLines } from "./line-diff.js";
import {
  listProposalRows,
  proposalLineCounts,
  type SkillProposalRow,
} from "./proposal-summaries.js";

export type SkillHistoryKind = "created" | "applied" | "rejected" | "undone" | "stale";

export interface SkillHistoryEntry {
  /** `<proposal id>:created` or `<proposal id>:<state>`. */
  id: string;
  proposalId: string;
  kind: SkillHistoryKind;
  /** Epoch ms: the proposal's creation time, or the time it reached this state. */
  at: number;
  summary: string;
  appliedBy: string | null;
  /** The saved version of an applied change; null for any other kind. */
  versionId: string | null;
  /** True only when `undoProposal` would accept this change now. */
  canUndo: boolean;
  /** Applied changes to the same skill saved after this one. */
  laterAppliedCount: number;
  added: number;
  removed: number;
}

export { countDiffLines };

/** An entry before the page adds its line counts, `canUndo` and `laterAppliedCount`. */
type BareEntry = Omit<SkillHistoryEntry, "canUndo" | "laterAppliedCount" | "added" | "removed">;

function entriesOf(proposal: SkillProposalRow, versions: Map<string, { id: number }>): BareEntry[] {
  const base = { proposalId: proposal.id, summary: proposal.summary ?? "" };
  const entries: BareEntry[] = [
    {
      ...base,
      id: `${proposal.id}:created`,
      kind: "created",
      at: proposal.createdAt,
      appliedBy: null,
      versionId: null,
    },
  ];
  if (proposal.state !== "pending") {
    const version = versions.get(proposal.id);
    const applied = proposal.state === "applied";
    entries.push({
      ...base,
      id: `${proposal.id}:${proposal.state}`,
      kind: proposal.state,
      at: proposal.updatedAt,
      appliedBy: applied ? proposal.appliedBy : null,
      versionId: applied && version !== undefined ? String(version.id) : null,
    });
  }
  return entries;
}

/**
 * The change history of one skill, newest first: a `created` entry for each
 * proposal and a second entry once it was applied, rejected, undone or found
 * stale. `canUndo` runs the same checks as undo, so it is false for an older
 * change once a later change rewrote the file, and for a file edited by hand.
 * No proposals, or no `skills.db`, give an empty history.
 */
export async function skillHistory(
  deps: ApplyDeps,
  skill: { path?: string; name?: string },
  limit: number,
  offset: number
): Promise<{ total: number; entries: SkillHistoryEntry[] }> {
  // A name without a path is a skill outside the watched folders. Its proposals
  // have no path, so a watched skill that shares the name stays out.
  const proposals = skill.path
    ? await listProposalRows(deps.store, { skillPath: skill.path })
    : (await listProposalRows(deps.store, { skillName: skill.name })).filter((p) => !p.skillPath);
  const versions = await latestVersionFacts(
    deps,
    proposals.filter((p) => p.state === "applied").map((p) => p.id)
  );
  const all = proposals.flatMap((p) => entriesOf(p, versions));
  // At the same time, the later step (applied, rejected) sorts above `created`.
  all.sort((a, b) => b.at - a.at || +(b.kind !== "created") - +(a.kind !== "created"));
  const appliedVersionIds = [...versions.values()].map((v) => v.id);
  const page = all.slice(offset, offset + limit);
  // Diffs are read for the proposals on this page only.
  const counts = await proposalLineCounts(deps.store, [...new Set(page.map((e) => e.proposalId))]);
  const readOnly = deps.store.isReadOnly();
  const entries = page.map((entry) => {
    const version = entry.kind === "applied" ? (versions.get(entry.proposalId) ?? null) : null;
    // A change with no diff, such as a new skill, keeps 0 and 0 here.
    const lines = counts.get(entry.proposalId);
    return {
      ...entry,
      added: lines?.hasDiff ? lines.added : 0,
      removed: lines?.hasDiff ? lines.removed : 0,
      canUndo:
        entry.kind === "applied" &&
        checkUndo({
          id: entry.proposalId,
          readOnly,
          state: "applied",
          version,
          folders: deps.folders,
        }).ok,
      laterAppliedCount:
        version === null ? 0 : appliedVersionIds.filter((id) => id > version.id).length,
    };
  });
  return { total: all.length, entries };
}

interface VersionFacts {
  id: number;
  path: string;
  writtenHash: string;
}

/**
 * The id, path and hash of the newest saved version for each proposal id, in
 * one query. It names its columns, so the saved previous content is not read.
 */
async function latestVersionFacts(
  deps: ApplyDeps,
  ids: readonly string[]
): Promise<Map<string, VersionFacts>> {
  const db = await deps.store.existingDb();
  const found = new Map<string, VersionFacts>();
  if (!db || ids.length === 0) return found;
  const rows = await db.all(
    `SELECT v.id, v.proposal_id, v.path, v.written_hash FROM skill_versions v
     JOIN (SELECT MAX(id) AS id FROM skill_versions
           WHERE proposal_id IN (SELECT value FROM json_each(?)) GROUP BY proposal_id) m
       ON v.id = m.id`,
    [JSON.stringify(ids)]
  );
  for (const row of rows) {
    found.set(String(row.proposal_id), {
      id: Number(row.id),
      path: String(row.path),
      writtenHash: String(row.written_hash),
    });
  }
  return found;
}

/**
 * Each proposal with `canUndo`: true only for an applied proposal that undo
 * would accept now, so false once a later change rewrote the file. Reads the
 * newest saved versions of all applied proposals in one query, then one file
 * hash per applied proposal, and nothing for the rest.
 */
export async function withCanUndo<T extends { id: string; state: string }>(
  deps: ApplyDeps,
  proposals: readonly T[]
): Promise<(T & { canUndo: boolean })[]> {
  const versions = await latestVersionFacts(
    deps,
    proposals.filter((p) => p.state === "applied").map((p) => p.id)
  );
  const readOnly = deps.store.isReadOnly();
  return proposals.map((p) => ({
    ...p,
    canUndo:
      p.state === "applied" &&
      checkUndo({
        id: p.id,
        readOnly,
        state: p.state,
        version: versions.get(p.id) ?? null,
        folders: deps.folders,
      }).ok,
  }));
}
