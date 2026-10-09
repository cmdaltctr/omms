import { expect, it, mock } from "bun:test";
import { buildCategoryList } from "../src/core/extraction.js";
import { analyzeProfile } from "../src/core/profile-analysis.js";

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

it("puts exactly the same category list in the OpenCode prompt", async () => {
  let openCodePrompt = "";
  mock.module("../src/config.js", () => ({
    refreshConfigIfChanged: () => {},
    CONFIG: {
      autoCaptureProviderStatus: { ready: true },
      userProfileAnalysisInterval: 1,
      opencodeProvider: "test",
      opencodeModel: "test",
      userProfileValidationEnabled: false,
      showUserProfileToasts: false,
    },
  }));
  mock.module("../src/services/tags.js", () => ({
    getTags: () => ({ user: { userEmail: "test@example.invalid" } }),
  }));
  mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
    userPromptManager: {
      skipTrivialPromptsForLearning: async () => 0,
      countUnanalyzedForUserLearning: async () => 1,
      getPromptsForUserLearning: async () => [
        { id: "test-prompt", content: "Prefer concise technical answers" },
      ],
      markMultipleAsUserLearningCaptured: async () => {},
    },
  }));
  mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
    loadOpencodeProvider: async () => ({
      generateStructuredOutput: async (request: { userPrompt: string }) => {
        openCodePrompt = request.userPrompt;
        return { preferences: [], patterns: [], workflows: [] };
      },
    }),
  }));
  mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
    getOpenCodeClient: async () => ({}),
  }));
  const { performUserProfileLearning } =
    await import("../src/adapters/opencode/profile-learning.js");
  await performUserProfileLearning(
    {} as Parameters<typeof performUserProfileLearning>[0],
    "/workspace"
  );
  const list = buildCategoryList(data);
  expect(list.length).toBeGreaterThan(0);
  expect(await sharedPrompt(stored)).toContain(list);
  expect(openCodePrompt).toContain(list);
  expect(openCodePrompt).not.toContain("communication_style");
  expect(openCodePrompt).toContain("## Existing Workflows");
  expect(openCodePrompt).toContain("Release workflow");
  expect(openCodePrompt).toContain("Preferences: 2 | Patterns: 2 | Workflows: 1");
});
