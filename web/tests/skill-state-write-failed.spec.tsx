import { expect, it } from "bun:test";
import { replyProblem } from "../src/lib/components/skills/ProposalCard.tsx";
import { translateSettings } from "../src/lib/i18n/settings.ts";

it("shows a fixed translatable message and asks for a reload when the state could not be saved", () => {
  const problem = replyProblem("state-write-failed", "The proposal state could not be saved");
  expect(problem.reload).toBe(true);
  expect(problem.message).toBe(
    "The state could not be saved, so SKILL.md is as it was. Try again."
  );
  for (const language of ["zh", "ar"] as const) {
    expect(translateSettings(problem.message, language)).not.toBe(problem.message);
  }
});

it("passes any other server error through and does not reload", () => {
  expect(replyProblem("stale", "Stale: the file changed")).toEqual({
    message: "Stale: the file changed",
    reload: false,
  });
});
