import { beforeEach, describe, expect, it, mock } from "bun:test";

// Task 4.4 of memory-context-controls: OpenCode profile-learning input obeys
// userProfileMaxContextBytes as a UTF-8 byte limit with the truncation marker inside the
// ceiling. The byte cut itself is checked in tests/profile-learning-characterisation.test.ts
// ("the UTF-8 byte cut and marker (OpenCode)"). This file keeps the two checks that test does
// not make. It drives the OpenCode entry, `performUserProfileLearning`, in this process with
// fake stores and the real CONFIG (change unify-profile-learning, task 6.4).

const MARKER = "[... context truncated to userProfileMaxContextBytes ...]";

const world = {
  prompts: [] as Array<{ id: string; content: string; createdAt: number }>,
  userPrompt: null as string | null,
};
const empty = { preferences: [], patterns: [], workflows: [] };

mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({
    user: {
      tag: "opencode_user_test",
      displayName: "Test User",
      userName: "tester",
      userEmail: "test@example.com",
    },
  }),
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => world.prompts.length,
    getPromptsForUserLearning: async () => world.prompts,
    markMultipleAsUserLearningCaptured: async () => {},
    markForUserLearning: async () => {},
  },
}));
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    getProfileById: async () => null,
    createProfile: async () => "p1",
    mergeProfileData: async () => empty,
    updateProfile: async () => true,
    decayInMemory: (data: unknown) => ({ data }),
    syncConfidence: () => {},
  },
}));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async (request: { userPrompt: string }) => {
      world.userPrompt = request.userPrompt;
      return empty;
    },
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));

const { CONFIG } = await import("../src/config.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");
const { performUserProfileLearning } = await import("../src/adapters/opencode/profile-learning.js");

async function runScenario(maxBytes: number, prompts: string[]): Promise<string | null> {
  world.prompts = prompts.map((content, i) => ({ id: `prompt-${i}`, content, createdAt: i + 1 }));
  CONFIG.userProfileMaxContextBytes = maxBytes;
  CONFIG.userProfileAnalysisInterval = prompts.length;
  await performUserProfileLearning("/workspace");
  return world.userPrompt;
}

function multibytePrompt(index: number): string {
  return (
    `${index}. 用户偏好简体中文回复并且遵循项目的中文注释规范 ` +
    `يفضّل المستخدم الرد بالعربية في التوثيق ` +
    "🚀🎉✨🚀🎉✨"
  );
}

beforeEach(() => {
  world.userPrompt = null;
  Object.assign(CONFIG, {
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
  });
  profileBackoff.recordSuccess();
});

describe("OpenCode profile-learning input byte limit (memory-context-controls 4.4)", () => {
  it("leaves input that already fits unchanged", async () => {
    const userPrompt = await runScenario(32768, [
      "Fix the login timeout",
      "Use British spelling in docs",
      "Prefer bun over npm",
      "Keep answers short",
      "Run the tests first",
    ]);
    expect(userPrompt).not.toContain(MARKER);
    expect(userPrompt).toContain("Fix the login timeout");
    expect(userPrompt).toContain("Prefer bun over npm");
  });

  it("does not change the stored prompts", async () => {
    const prompts = Array.from({ length: 20 }, (_, i) => multibytePrompt(i + 1));
    const userPrompt = await runScenario(5000, prompts);
    expect(userPrompt).toBeTruthy();
    expect(world.prompts.map((prompt) => prompt.content)).toEqual(prompts);
  });
});
