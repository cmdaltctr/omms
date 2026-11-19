import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { analyzeProfile } from "../src/core/profile-analysis.js";
import { MIN_WORKFLOW_STEPS, WORKFLOW_PROMPT_RULES } from "../src/core/extraction.js";
import { buildFullProfileInput } from "../src/core/profile-learning/model-input.js";

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

it("sends every host's pass through the one system prompt and the shared model input", () => {
  // Since change unify-profile-learning, the shared pass builds its input in model-input.ts
  // and calls analyzeProfile, whose system prompt holds the rules (test above). No profile
  // learning module writes a second system prompt.
  const pass = readFileSync("src/core/profile-learning/pass.ts", "utf8");
  expect(pass).toContain("analyzeProfile(");
  expect(pass).toContain("buildProfileLearningInput(");
  for (const file of ["pass.ts", "model-input.ts", "validation.ts", "fallback.ts"]) {
    const source = readFileSync(`src/core/profile-learning/${file}`, "utf8");
    expect(source).not.toContain("user behavior analyst");
  }
  const input = buildFullProfileInput([{ content: "Release the package" }], null);
  expect(input).toContain("Distinct, named step sequences");
});
