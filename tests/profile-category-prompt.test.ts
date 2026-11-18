import { expect, it, mock } from "bun:test";
import { buildCategoryList } from "../src/core/extraction.js";
import { analyzeProfile } from "../src/core/profile-analysis.js";
import { buildFullProfileInput } from "../src/core/profile-learning/model-input.js";

const data = {
  preferences: [{ category: "communication_style" }, { category: "Communication style" }],
  patterns: [{ category: "Communication style" }, { category: "UI/UX" }],
  workflows: [
    { description: "Release workflow", steps: ["Branch", "Test", "Release"], frequency: 3 },
  ],
};
const stored = { id: "test-profile", profileData: JSON.stringify(data), totalPromptsAnalyzed: 5 };
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    mergeProfileData: async () => data,
    getActiveProfile: async () => stored,
    decayInMemory: (profile: unknown) => ({ data: profile }),
    updateProfile: async () => true,
  },
}));
mock.module("../src/services/logger.js", () => ({ log: () => {} }));

async function sharedPrompt(existing: typeof stored | null): Promise<string> {
  let system = "";
  await analyzeProfile(
    {
      provider: "test",
      modelId: "test",
      complete: async (prompt) => {
        system = prompt;
        return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
      },
    },
    "Prefer concise technical answers",
    existing
  );
  return system;
}

it("puts existing category labels in the shared prompt", async () => {
  expect(await sharedPrompt(stored)).toContain(buildCategoryList(data));
});

it("omits the category list on the first profile analysis", async () => {
  expect(await sharedPrompt(null)).not.toContain("## Existing Categories");
});

it("puts exactly the same category list in the shared model input", async () => {
  // Since change unify-profile-learning, every host sends the input from model-input.ts
  // (it was the OpenCode loop's input before).
  const input = buildFullProfileInput([{ content: "Prefer concise technical answers" }], {
    profileData: JSON.stringify(data),
  });
  const list = buildCategoryList(data);
  expect(list.length).toBeGreaterThan(0);
  expect(await sharedPrompt(stored)).toContain(list);
  expect(input).toContain(list);
  expect(input).not.toContain("communication_style");
  expect(input).toContain("## Existing Workflows");
  expect(input).toContain("Release workflow");
  expect(input).toContain("Preferences: 2 | Patterns: 2 | Workflows: 1");
});
