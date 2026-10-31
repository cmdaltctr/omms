import { expect, it } from "bun:test";
import { proposalChanged } from "../src/lib/components/skills/SkillDetail.tsx";
import type { Proposal, SkillDetailData } from "../src/lib/skills-api.ts";

const proposal = (id: string, state: Proposal["state"]): Proposal => ({
  id,
  kind: "improve",
  skillName: "alpha",
  skillPath: "/skills/alpha/SKILL.md",
  content: "new",
  diff: "",
  summary: "s",
  evidenceTurnIds: [],
  state,
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
});

it("updates the card, bumps the history and reloads the detail after a proposal changes", () => {
  const calls: string[] = [];
  let detail = {
    proposals: [proposal("a", "pending"), proposal("b", "pending")],
  } as SkillDetailData;
  proposalChanged(proposal("a", "applied"), {
    setDetail: (update) => {
      detail = update(detail) as SkillDetailData;
      calls.push("optimistic");
    },
    bumpHistory: () => calls.push("history"),
    reload: () => calls.push("reload"),
  });
  expect(detail.proposals.map((p) => p.state)).toEqual(["applied", "pending"]);
  // The header tick and date come from the reloaded skill row, so the reload must run.
  expect(calls).toEqual(["optimistic", "history", "reload"]);
});
