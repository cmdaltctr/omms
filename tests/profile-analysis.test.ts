import { expect, it } from "bun:test";
import { analyzeProfile } from "../src/core/profile-analysis.js";

it("analyses a profile through a host-neutral model port", async () => {
  const calls: Array<[string, string]> = [];
  const profile = JSON.stringify({
    preferences: [{ category: "style", description: "Concise", confidence: 0.8, evidence: [] }],
    patterns: [],
    workflows: [],
  });
  const result = await analyzeProfile(
    {
      provider: "external",
      modelId: "small",
      complete: async (system, prompt) => {
        calls.push([system, prompt]);
        return profile;
      },
    },
    "1. Prefer short answers",
    null
  );
  expect(calls[0]?.[0]).toContain("create");
  expect(calls[0]?.[1]).toBe("1. Prefer short answers");
  expect(result.raw.preferences[0]?.description).toBe("Concise");
  expect(result.merged).toBeNull();
});
