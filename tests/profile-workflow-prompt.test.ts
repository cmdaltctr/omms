import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { analyzeProfile } from "../src/core/profile-analysis.js";
import { MIN_WORKFLOW_STEPS, WORKFLOW_PROMPT_RULES } from "../src/core/extraction.js";

it("tells the model what a workflow is and the minimum step count", async () => {
  let system = "";
  await analyzeProfile(
    {
      provider: "external",
      modelId: "small",
      complete: async (s) => {
        system = s;
        return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
      },
    },
    "1. Release the package",
    null
  );
  expect(MIN_WORKFLOW_STEPS).toBe(3);
  expect(system).toContain(WORKFLOW_PROMPT_RULES);
  expect(WORKFLOW_PROMPT_RULES).toContain("at least 3");
  expect(WORKFLOW_PROMPT_RULES.toLowerCase()).toContain("personality");
});

it("puts the same workflow rules in both OpenCode profile prompts", () => {
  // The OpenCode prompts are built inside functions that need a live client, so this
  // checks the source. Each prompt must interpolate the shared rules.
  const source = readFileSync("src/adapters/opencode/profile-learning.ts", "utf8");
  const uses = source.split("${WORKFLOW_PROMPT_RULES}").length - 1;
  expect(uses).toBe(2);
});
