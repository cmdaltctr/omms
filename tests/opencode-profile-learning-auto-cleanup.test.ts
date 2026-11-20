import { beforeEach, describe, expect, it, mock } from "bun:test";

// After an OpenCode learning pass saves, the shared automatic cleanup starts when the count
// of analysed prompts passes a multiple of the interval. Learning does not wait for it and
// does not fail when it fails. The test drives the OpenCode entry, `performUserProfileLearning`,
// in this process with fake stores and the real CONFIG (change unify-profile-learning, task 6.4).

const world = {
  previous: 0,
  cleanup: "pending" as "pending" | "rejects",
  started: [] as string[],
  marked: [] as string[],
};

const prompts = Array.from({ length: 5 }, (_, i) => ({
  id: `prompt-${i}`,
  content: `Please refactor module number ${i} of the settings page`,
  createdAt: i + 1,
}));
const empty = { preferences: [], patterns: [], workflows: [] };

mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({
    user: { tag: "t", displayName: "T", userName: "t", userEmail: "t@example.com" },
  }),
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => 5,
    getPromptsForUserLearning: async () => prompts,
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      world.marked.push(...ids);
    },
    markForUserLearning: async () => {},
  },
}));
const read = async () => ({
  id: "p1",
  version: 7,
  profileData: JSON.stringify(empty),
  totalPromptsAnalyzed: world.previous,
});
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    // The learned-prompt record (TDR-091): nothing recorded.
    getLearnedPromptIds: async () => [],
    clearLearnedPromptIds: async () => {},
    getActiveProfile: read,
    getProfileById: read,
    createProfile: async () => "p1",
    mergeProfileData: async () => empty,
    updateProfile: async () => true,
    decayInMemory: (data: unknown) => ({ data }),
    syncConfidence: () => {},
  },
}));
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: (userId: string) => {
    world.started.push(userId);
    if (world.cleanup === "rejects") return Promise.reject(new Error("boom"));
    return new Promise(() => {});
  },
}));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({ generateStructuredOutput: async () => empty }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));

const { CONFIG } = await import("../src/config.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");
const { performUserProfileLearning } = await import("../src/adapters/opencode/profile-learning.js");

const unhandled: unknown[] = [];
process.on("unhandledRejection", (error) => unhandled.push(error));

async function runScenario(options: {
  previous: number;
  enabled?: boolean;
  interval?: number;
  cleanup: "pending" | "rejects";
}) {
  world.previous = options.previous;
  world.cleanup = options.cleanup;
  CONFIG.userProfileAutoCleanupEnabled = options.enabled ?? true;
  CONFIG.userProfileAutoCleanupInterval = options.interval ?? 100;
  await performUserProfileLearning("/workspace");
  // The cleanup starts in the background; give it time to start and to reject.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { started: world.started, marked: world.marked.length, canRun: profileBackoff.canRun() };
}

beforeEach(() => {
  world.started = [];
  world.marked = [];
  unhandled.length = 0;
  Object.assign(CONFIG, {
    autoCaptureProviderStatus: { ready: true, mode: "opencode", issues: [] },
    opencodeProvider: "opencode-go",
    opencodeModel: "deepseek-v4-flash",
    memoryModel: undefined,
    memoryApiUrl: undefined,
    memoryApiKey: undefined,
    userProfileAnalysisInterval: 5,
    userProfileMaxContextBytes: 32768,
    userProfileValidationEnabled: false,
    showUserProfileToasts: false,
  });
  profileBackoff.recordSuccess();
});

describe("OpenCode automatic cleanup after learning", () => {
  it("starts one run when the pass crosses the interval, and does not wait for it", async () => {
    const result = await runScenario({ previous: 95, cleanup: "pending" });
    expect(result.started).toEqual(["t@example.com"]);
    expect(result.marked).toBe(5);
    expect(result.canRun).toBe(true);
  });

  it("starts no run when the pass does not cross the interval", async () => {
    const result = await runScenario({ previous: 90, cleanup: "pending" });
    expect(result.started).toEqual([]);
    expect(result.marked).toBe(5);
  });

  it("starts no run when the setting is off", async () => {
    const result = await runScenario({ previous: 95, enabled: false, cleanup: "pending" });
    expect(result.started).toEqual([]);
  });

  it("does not fail learning when the run rejects", async () => {
    const result = await runScenario({ previous: 95, cleanup: "rejects" });
    expect(unhandled).toEqual([]);
    expect(result.started).toEqual(["t@example.com"]);
    expect(result.marked).toBe(5);
    expect(result.canRun).toBe(true);
  });
});
