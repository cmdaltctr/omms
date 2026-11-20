import { beforeEach, describe, expect, it, mock } from "bun:test";

// After a Pi learning pass saves, the shared automatic cleanup starts when the count of
// analysed prompts passes a multiple of the interval. Pi hands over its own model. Learning
// does not wait for the run and does not fail when it fails.

mock.module("../src/services/logger.js", () => ({ log: () => {} }));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ user: { userEmail: "me@example.invalid", displayName: "Me", userName: "me" } }),
}));

let previous = 95;
const saves: number[] = [];
const empty = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  userProfileManager: {
    // The learned-prompt record (TDR-091): nothing recorded.
    getLearnedPromptIds: async () => [],
    clearLearnedPromptIds: async () => {},
    getActiveProfile: async () => ({
      id: "p1",
      version: 3,
      profileData: empty,
      totalPromptsAnalyzed: previous,
    }),
    getProfileById: async () => null,
    createProfile: async () => "p1",
    mergeProfileData: async () => ({ preferences: [], patterns: [], workflows: [] }),
    updateProfile: async (_id: string, _data: unknown, count: number) => {
      saves.push(count);
      return true;
    },
  },
}));

// Pi reads its recorded prompts from the shared prompt store (change unify-profile-learning).
const waiting = ["a", "b", "c", "d", "e"].map((content, i) => ({
  id: `p${i}`,
  content: `Please refactor module ${content} of the settings page`,
  createdAt: i + 1,
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: {
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => waiting.length,
    getPromptsForUserLearning: async () => waiting,
    markMultipleAsUserLearningCaptured: async () => {},
    markForUserLearning: async () => {},
  },
}));

const modelsAtStart: Array<string | undefined> = [];
const started: Array<{
  userId: string;
  options: { resolveModel?: () => unknown; settings?: { memoryModel?: string } };
}> = [];
let cleanup: "pending" | "rejects" = "pending";
mock.module("../src/services/user-profile/auto-cleanup.js", () => ({
  startAutoProfileCleanup: (
    userId: string,
    options: { resolveModel?: () => unknown; settings?: { memoryModel?: string } }
  ) => {
    started.push({ userId, options });
    modelsAtStart.push(options.settings?.memoryModel);
    if (cleanup === "rejects") return Promise.reject(new Error("boom"));
    return new Promise(() => {});
  },
}));

const { CONFIG } = await import("../src/config.js");
const { adaptPiProfileModel, learnPiProfile } = await import("../src/adapters/pi/profile.js");
const { profileBackoff } = await import("../src/core/profile-backoff.js");

const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
const model = {
  provider: "stub",
  modelId: "stub",
  async complete() {
    return reply;
  },
};
const handle = {
  provider: "pi",
  modelId: "pi-model",
  async complete() {
    return { content: [{ type: "text", text: reply }], stopReason: "stop" };
  },
};

// The run starts after a dynamic import, a moment after learning returns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  started.length = 0;
  modelsAtStart.length = 0;
  saves.length = 0;
  previous = 95;
  cleanup = "pending";
  CONFIG.userProfileAnalysisInterval = 5;
  CONFIG.userProfileAutoCleanupEnabled = true;
  CONFIG.userProfileAutoCleanupInterval = 100;
  profileBackoff.recordSuccess();
});

describe("Pi automatic cleanup after learning", () => {
  it("starts one run when the pass crosses the interval, with Pi's model, and does not wait", async () => {
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    expect(saves).toEqual([5]);
    expect(started).toHaveLength(1);
    expect(started[0]!.userId).toBe("me@example.invalid");
    expect(started[0]!.options.resolveModel?.()).toBe(model);
  });

  it("gives each run the external model settings that are live at that pass", async () => {
    CONFIG.memoryModel = "model-a";
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    CONFIG.memoryModel = "model-b";
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    expect(modelsAtStart).toEqual(["model-a", "model-b"]);
  });

  it("hands over the Pi model handle as a profile model", async () => {
    await learnPiProfile({
      directory: "/tmp",
      model: () => adaptPiProfileModel(handle as never),
    });
    await settle();
    expect(started).toHaveLength(1);
    const given = started[0]!.options.resolveModel?.() as { modelId: string; complete: unknown };
    expect(given.modelId).toBe("pi-model");
    expect(typeof given.complete).toBe("function");
  });

  it("starts no run when the pass does not cross the interval", async () => {
    previous = 90;
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    expect(saves).toEqual([5]);
    expect(started).toHaveLength(0);
  });

  it("starts no run when the setting is off", async () => {
    CONFIG.userProfileAutoCleanupEnabled = false;
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    expect(started).toHaveLength(0);
  });

  it("does not fail learning when the run rejects", async () => {
    cleanup = "rejects";
    await learnPiProfile({ directory: "/tmp", model: () => model as never });
    await settle();
    expect(started).toHaveLength(1);
    expect(saves).toEqual([5]);
    expect(profileBackoff.canRun()).toBe(true);
  });

  it("starts no run when the save met a newer version", async () => {
    const manager = (await import("../src/services/user-profile/user-profile-manager.js"))
      .userProfileManager as unknown as { updateProfile: () => Promise<boolean> };
    const original = manager.updateProfile;
    manager.updateProfile = async () => false;
    try {
      await learnPiProfile({ directory: "/tmp", model: () => model as never });
    } finally {
      manager.updateProfile = original;
    }
    await settle();
    expect(started).toHaveLength(0);
  });
});
