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
const { performPiProfileLearning } = await import("../src/adapters/pi/profile.js");
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

const prompts = ["a", "b", "c", "d", "e"];

// The run starts after a dynamic import, a moment after learning returns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  started.length = 0;
  saves.length = 0;
  previous = 95;
  cleanup = "pending";
  CONFIG.userProfileAutoCleanupEnabled = true;
  CONFIG.userProfileAutoCleanupInterval = 100;
  profileBackoff.recordSuccess();
});

describe("Pi automatic cleanup after learning", () => {
  it("starts one run when the pass crosses the interval, with Pi's model, and does not wait", async () => {
    await performPiProfileLearning({
      directory: "/tmp",
      prompts,
      resolveProfileModel: () => model as never,
    });
    await settle();
    expect(saves).toEqual([5]);
    expect(started).toHaveLength(1);
    expect(started[0]!.userId).toBe("me@example.invalid");
    expect(started[0]!.options.resolveModel?.()).toBe(model);
  });

  it("hands over the Pi model handle as a profile model when no profile model is given", async () => {
    await performPiProfileLearning({
      directory: "/tmp",
      prompts,
      resolveModel: () => handle as never,
    });
    await settle();
    expect(started).toHaveLength(1);
    const given = started[0]!.options.resolveModel?.() as { modelId: string; complete: unknown };
    expect(given.modelId).toBe("pi-model");
    expect(typeof given.complete).toBe("function");
  });

  it("starts no run when the pass does not cross the interval", async () => {
    previous = 90;
    await performPiProfileLearning({
      directory: "/tmp",
      prompts,
      resolveProfileModel: () => model as never,
    });
    await settle();
    expect(saves).toEqual([5]);
    expect(started).toHaveLength(0);
  });

  it("starts no run when the setting is off", async () => {
    CONFIG.userProfileAutoCleanupEnabled = false;
    await performPiProfileLearning({
      directory: "/tmp",
      prompts,
      resolveProfileModel: () => model as never,
    });
    await settle();
    expect(started).toHaveLength(0);
  });

  it("does not fail learning when the run rejects", async () => {
    cleanup = "rejects";
    await performPiProfileLearning({
      directory: "/tmp",
      prompts,
      resolveProfileModel: () => model as never,
    });
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
      await performPiProfileLearning({
        directory: "/tmp",
        prompts,
        resolveProfileModel: () => model as never,
      });
    } finally {
      manager.updateProfile = original;
    }
    await settle();
    expect(started).toHaveLength(0);
  });
});
