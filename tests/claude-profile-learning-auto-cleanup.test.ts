import { beforeEach, describe, expect, it, mock } from "bun:test";

// After a Claude Code learning pass saves, the shared automatic cleanup starts when the count
// of analysed prompts passes a multiple of the interval. It uses the same external model as
// learning. Learning does not wait for the run and does not fail when it fails.

mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
}));
mock.module("../src/services/user-prompt/profile-catch-up-lease.js", () => ({
  CatchUpLease: class {
    async isActive() {
      return false;
    }
  },
}));

const prompts = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, content: `Prompt ${i}` }));
const marked: string[] = [];
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => 5,
    getPromptsForUserLearning: async () => prompts,
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      marked.push(...ids);
    },
  },
}));

let previous = 95;
const empty = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
let saveAccepted = true;
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    getActiveProfile: async () => ({
      id: "p1",
      version: 3,
      profileData: empty,
      totalPromptsAnalyzed: previous,
    }),
    getProfileById: async () => null,
    createProfile: async () => "p1",
    mergeProfileData: async () => ({ preferences: [], patterns: [], workflows: [] }),
    updateProfile: async () => saveAccepted,
  },
}));

const started: Array<{ userId: string; options: { resolveModel?: () => unknown } }> = [];
let cleanup: "pending" | "rejects" = "pending";
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: (userId: string, options: { resolveModel?: () => unknown }) => {
    started.push({ userId, options });
    if (cleanup === "rejects") return Promise.reject(new Error("boom"));
    return new Promise(() => {});
  },
}));

const { CONFIG } = await import("../src/config.js");
const { learnClaudeProfile } = await import("../src/importer/claude-profile-learning.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");

const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
const model = {
  provider: "stub",
  modelId: "stub",
  async complete() {
    return reply;
  },
};

// The run starts after a dynamic import, a moment after learning returns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  started.length = 0;
  marked.length = 0;
  previous = 95;
  saveAccepted = true;
  cleanup = "pending";
  CONFIG.userProfileAnalysisInterval = 5;
  CONFIG.userProfileAutoCleanupEnabled = true;
  CONFIG.userProfileAutoCleanupInterval = 100;
  profileBackoff.recordSuccess();
});

describe("Claude Code automatic cleanup after learning", () => {
  it("starts one run when the pass crosses the interval, with the learning model", async () => {
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(marked).toHaveLength(5);
    expect(started).toHaveLength(1);
    expect(started[0]!.userId).toBe("me@example.invalid");
    expect(started[0]!.options.resolveModel?.()).toBe(model);
  });

  it("starts no run when the pass does not cross the interval", async () => {
    previous = 90;
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(marked).toHaveLength(5);
    expect(started).toHaveLength(0);
  });

  it("starts no run when the setting is off", async () => {
    CONFIG.userProfileAutoCleanupEnabled = false;
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(started).toHaveLength(0);
  });

  it("does not fail learning when the run rejects", async () => {
    cleanup = "rejects";
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(started).toHaveLength(1);
    expect(marked).toHaveLength(5);
    expect(profileBackoff.canRun()).toBe(true);
  });

  it("starts no run when the save did not land", async () => {
    saveAccepted = false;
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(marked).toHaveLength(0);
    expect(started).toHaveLength(0);
  });

  it("starts no run when learning is waiting after a failure", async () => {
    profileBackoff.recordFailure();
    await learnClaudeProfile("/tmp", () => model as never);
    await settle();
    expect(started).toHaveLength(0);
  });
});
