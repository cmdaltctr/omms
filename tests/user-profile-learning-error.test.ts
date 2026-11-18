import { describe, expect, it, mock } from "bun:test";

// Issue #265: when the OpenCode model fails and no external API is configured, learning must
// report the OpenCode error, not "External API not configured". The test drives the OpenCode
// entry, `performUserProfileLearning`, in this process with fake stores and the real CONFIG
// (change unify-profile-learning, task 6.4).

const PROVIDER_ERROR =
  "omms: opencode reported APIError: Thinking mode does not support this tool_choice";

const logs: Array<{ message: string; data: Record<string, unknown> | null }> = [];
const prompts = Array.from({ length: 10 }, (_, i) => ({
  id: `prompt-${i}`,
  content: `Implement feature ${i}`,
  createdAt: i + 1,
}));
let structuredCalls = 0;

mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: Record<string, unknown>) =>
    logs.push({ message, data: data ?? null }),
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({
    user: { tag: "t", displayName: "Test", userName: "test", userEmail: "test@example.com" },
  }),
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => prompts.length,
    getPromptsForUserLearning: async () => prompts,
    markMultipleAsUserLearningCaptured: async () => {},
    markForUserLearning: async () => {},
  },
}));
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => null,
    getProfileById: async () => null,
    createProfile: async () => "p1",
    mergeProfileData: async () => ({ preferences: [], patterns: [], workflows: [] }),
    updateProfile: async () => true,
    decayInMemory: (data: unknown) => ({ data }),
    syncConfidence: () => {},
  },
}));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({
    generateStructuredOutput: async () => {
      structuredCalls++;
      throw new Error(PROVIDER_ERROR);
    },
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));

const { CONFIG } = await import("../src/config.js");
const { profileFailureCode } = await import("../src/core/profile-failure.js");
const { performUserProfileLearning } = await import("../src/adapters/opencode/profile-learning.js");

describe("user profile learning error propagation (#265)", () => {
  // Changed by the user's decision in design D9 ("the pass returns `failed` with the same
  // reason"): the OpenCode loop rethrew the provider error before this change. The shared pass
  // now returns `failed` with the reason code of that same error.
  it("preserves the opencode provider error when no manual fallback is configured", async () => {
    Object.assign(CONFIG, {
      autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
      opencodeProvider: "opencode-go",
      opencodeModel: "deepseek-v4-flash",
      memoryModel: undefined,
      memoryApiUrl: undefined,
      memoryApiKey: undefined,
      userProfileAnalysisInterval: 10,
      userProfileMaxContextBytes: 32768,
      userProfileValidationEnabled: false,
      showUserProfileToasts: false,
    });

    const result = await performUserProfileLearning("/workspace");

    expect(structuredCalls).toBe(1);
    expect(result).toEqual({
      outcome: "failed",
      reason: profileFailureCode(new Error(PROVIDER_ERROR)),
    });
    expect(profileFailureCode(new Error("External API not configured"))).not.toBe(result.reason);
    const failure = logs.find((entry) => entry.message === "OpenCode profile learning failed");
    expect(failure?.data).toEqual({ host: "opencode", reason: "error" });
  });
});
