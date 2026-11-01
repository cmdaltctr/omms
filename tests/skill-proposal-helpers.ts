import type {
  ProposalFilter,
  SkillProposal,
} from "../src/services/skill-learning/proposal-store.js";
import type { SkillStore } from "../src/services/skill-learning/store.js";

/**
 * The full proposals of a store, newest first, for tests that check content and diff.
 * Production code lists summaries (`listProposalSummaries`), so it has no such reader.
 * The modules load when called, so a test that mocks `config.js` first still works.
 */
export async function allProposals(
  store: SkillStore,
  filter: ProposalFilter = {}
): Promise<SkillProposal[]> {
  const { getProposal } = await import("../src/services/skill-learning/proposal-store.js");
  const { listProposalRows } = await import("../src/services/skill-learning/proposal-summaries.js");
  const rows = await listProposalRows(store, filter);
  const full = await Promise.all(rows.map((row) => getProposal(store, row.id)));
  return full.filter((proposal): proposal is SkillProposal => proposal !== null);
}
