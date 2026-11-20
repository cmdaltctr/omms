import { beforeEach, describe, expect, it, mock } from "bun:test";

// OpenCode learning saves with the version it read. When a save meets a newer version, the
// shared pass reloads the profile, merges again and saves with the newer version. After the
// last attempt it keeps the prompts and starts the profile backoff. The test drives the
// OpenCode entry, `performUserProfileLearning`, in this process with fake stores and the
// real CONFIG (change unify-profile-learning, task 6.4).

const world = {
  reads: 0,
  failedSaves: 0,
  saves: [] as number[],
  marked: [] as string[],
  decays: 0,
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
// Every read finds a newer version, as if another writer saved in between.
const read = async () => ({
  id: "p1",
  version: 7 + world.reads++,
  profileData: JSON.stringify(empty),
  totalPromptsAnalyzed: 0,
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
    updateProfile: async (
      _id: string,
      _data: unknown,
      _count: number,
      _summary: string,
      expectedVersion: number
    ) => {
      world.saves.push(expectedVersion);
      if (world.saves.length <= world.failedSaves) return false;
      return true;
    },
    decayInMemory: (data: unknown) => {
      world.decays++;
      return { data };
    },
    syncConfidence: () => {},
  },
}));
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: () => new Promise(() => {}),
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

async function runScenario(failedSaves: number) {
  world.failedSaves = failedSaves;
  await performUserProfileLearning("/workspace");
  return { saves: world.saves, marked: world.marked.length, canRun: profileBackoff.canRun() };
}

beforeEach(() => {
  world.reads = 0;
  world.saves = [];
  world.marked = [];
  world.decays = 0;
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
    userProfileDecayBeforeMerge: false,
    showUserProfileToasts: false,
  });
  profileBackoff.recordSuccess();
});

describe("OpenCode profile learning save conflicts", () => {
  it("saves with the version it read and marks the prompts when the first save succeeds", async () => {
    const result = await runScenario(0);
    expect(result.saves).toEqual([7]);
    expect(result.marked).toBe(5);
    expect(result.canRun).toBe(true);
  });

  it("reloads the profile and saves with the newer version after one conflict", async () => {
    const result = await runScenario(1);
    expect(result.saves).toEqual([7, 8]);
    expect(result.marked).toBe(5);
  });

  it("keeps the prompts and starts the backoff after three conflicts", async () => {
    const result = await runScenario(99);
    expect(result.saves).toEqual([7, 8, 9]);
    expect(result.marked).toBe(0);
    expect(result.canRun).toBe(false);
  });

  // Changed by the user's decision "no decay" (design D9): OpenCode decayed the stored profile
  // on every read and retry before this change. Decay now runs only with the setting on.
  it("does not decay the stored profile on a retry by default", async () => {
    await runScenario(1);
    expect(world.decays).toBe(0);
  });

  it("decays before the analysis and again before the retry with the setting on", async () => {
    CONFIG.userProfileDecayBeforeMerge = true;
    const result = await runScenario(1);
    expect(result.saves).toEqual([7, 8]);
    expect(world.decays).toBe(2);
  });
});
