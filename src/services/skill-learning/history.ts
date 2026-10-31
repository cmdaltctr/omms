import { canUndoProposal, type ApplyDeps } from "./apply.js";
import { listProposals, type SkillProposal } from "./proposal-store.js";

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

/** Added and removed line counts of a unified-style line diff. Hunk headers are skipped. */
export function countDiffLines(diff: string | null): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of (diff ?? "").split("\n")) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** The newest saved version id for each proposal id. */
async function latestVersionIds(deps: ApplyDeps, ids: string[]): Promise<Map<string, number>> {
  const db = await deps.store.existingDb();
  const found = new Map<string, number>();
  if (!db || ids.length === 0) return found;
  const rows = await db.all(
    `SELECT proposal_id, MAX(id) AS id FROM skill_versions
     WHERE proposal_id IN (SELECT value FROM json_each(?)) GROUP BY proposal_id`,
    [JSON.stringify(ids)]
  );
  for (const row of rows) found.set(String(row.proposal_id), Number(row.id));
  return found;
}

function entriesOf(
  proposal: SkillProposal,
  versions: Map<string, number>
): Omit<SkillHistoryEntry, "canUndo" | "laterAppliedCount">[] {
  const counts = countDiffLines(proposal.diff);
  const base = { proposalId: proposal.id, summary: proposal.summary ?? "", ...counts };
  const entries: Omit<SkillHistoryEntry, "canUndo" | "laterAppliedCount">[] = [
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
      versionId: applied && version !== undefined ? String(version) : null,
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
    ? await listProposals(deps.store, { skillPath: skill.path })
    : (await listProposals(deps.store, { skillName: skill.name })).filter((p) => !p.skillPath);
  const versions = await latestVersionIds(
    deps,
    proposals.filter((p) => p.state === "applied").map((p) => p.id)
  );
  const all = proposals.flatMap((p) => entriesOf(p, versions));
  // At the same time, the later step (applied, rejected) sorts above `created`.
  all.sort((a, b) => b.at - a.at || +(b.kind !== "created") - +(a.kind !== "created"));
  const appliedVersionIds = [...versions.values()];
  const page = all.slice(offset, offset + limit);
  const entries = await Promise.all(
    page.map(async (entry) => {
      const version = entry.kind === "applied" ? Number(entry.versionId) : null;
      return {
        ...entry,
        canUndo: version !== null && (await canUndoProposal(entry.proposalId, deps)),
        laterAppliedCount:
          version === null ? 0 : appliedVersionIds.filter((id) => id > version).length,
      };
    })
  );
  return { total: all.length, entries };
}

/**
 * Each proposal with `canUndo`: true only for an applied proposal that undo
 * would accept now, so false once a later change rewrote the file. Reads one
 * saved version and one file hash per applied proposal, and nothing for the rest.
 */
export async function withCanUndo(
  deps: ApplyDeps,
  proposals: readonly SkillProposal[]
): Promise<(SkillProposal & { canUndo: boolean })[]> {
  return Promise.all(
    proposals.map(async (p) => ({
      ...p,
      canUndo: p.state === "applied" && (await canUndoProposal(p.id, deps)),
    }))
  );
}
