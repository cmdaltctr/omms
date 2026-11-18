import { countDiffLines } from "./line-diff.js";
import {
  listProposalRows,
  readProposalDiffs,
  type ProposalFilter,
  type SkillProposalRow,
} from "../storage/skills/proposals.js";
import type { SkillStore } from "../storage/skills/store.js";

/**
 * Proposal lists without the proposed content or the diff (TDR-059). Those two
 * columns are the bulk of a proposal, so a list names its columns and reads
 * them only to count lines, and only for the proposals it returns. Nothing
 * here reads `CONFIG`.
 */

export { listProposalRows, type SkillProposalRow };

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
  for (const row of await readProposalDiffs(store, ids)) {
    counts.set(
      row.id,
      row.diff === null
        ? { added: contentLines(row.content ?? ""), removed: 0, hasDiff: false }
        : { ...countDiffLines(row.diff), hasDiff: true }
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
