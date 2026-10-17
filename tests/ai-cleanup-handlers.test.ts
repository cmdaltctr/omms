import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

let directory: string;
const userId = "ai-cleanup-handlers@example.invalid";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-ai-cleanup-handlers-"));
});

afterEach(async () => {
  const { stopAiCleanupJob } = await import("../src/services/user-profile/ai-cleanup-job.js");
  stopAiCleanupJob(userId);
  await cleanupTursoTestDirectory(directory);
});

const item = (description: string, confidence: number) => ({
  category: "Style",
  description,
  confidence,
  frequency: 1,
  evidence: ["Evidence"],
  lastSeen: 123,
});

async function setup() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  CONFIG.userEmailOverride = userId;
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  userProfileManager.reset();
  // Confidence sets the order the dialog lists: pref_0 "Target", pref_1 "Source", pref_2 "Stale".
  await userProfileManager.createProfile(
    userId,
    "Test",
    "test",
    userId,
    {
      preferences: [item("Stale", 0.5), item("Target", 0.9), item("Source", 0.8)],
      patterns: [],
      workflows: [],
    },
    0
  );
  const api = await import("../src/services/ai-cleanup-handlers.js");
  return { api, manager: userProfileManager };
}

// A fake model that merges pref_1 into pref_0 and removes pref_2.
async function callBatch() {
  return {
    diff: {
      kept: [],
      merged: [{ ids: ["pref_0", "pref_1"], result: "Target and source" }],
      removed: [{ id: "pref_2", reason: "dup" }],
    },
    mergedItems: { pref_0: { ...item("Target and source", 0.9), frequency: 2 } },
  };
}

async function settle(api: Awaited<ReturnType<typeof setup>>["api"]) {
  for (let i = 0; i < 200; i++) {
    const status = await api.handleAiCleanupStatus(undefined);
    if (status.data && status.data.status.state !== "running") return status.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}

async function descriptions(manager: Awaited<ReturnType<typeof setup>>["manager"]) {
  const profile = await manager.getActiveProfile(userId);
  return JSON.parse(profile!.profileData).preferences.map((p: any) => p.description);
}

it("fails at once when the dialog's profile version is stale", async () => {
  const { api, manager } = await setup();
  const profile = await manager.getActiveProfile(userId);
  const result = await api.handleAiCleanupStart(
    undefined,
    { includeIds: ["pref_0"], profileVersion: profile!.version - 1 },
    { callBatch }
  );
  expect(result).toEqual({
    success: false,
    error: "Profile changed. Reload it before running AI cleanup.",
  });
  expect((await api.handleAiCleanupStatus(undefined)).data).toBeNull();
});

it("applies the ticked changes after learning saved a newer version", async () => {
  const { api, manager } = await setup();
  const profile = await manager.getActiveProfile(userId);
  const started = await api.handleAiCleanupStart(
    undefined,
    { includeIds: [], profileVersion: profile!.version },
    { callBatch }
  );
  expect(started.success).toBe(true);
  const done = await settle(api);
  expect(done.status.state).toBe("done");

  // Learning adds an item and raises a counter while the review screen is open.
  const learnt = JSON.parse(profile!.profileData);
  learnt.preferences.push(item("Learnt during the run", 0.6));
  learnt.preferences[0].frequency = 5;
  await manager.updateProfile(profile!.id, learnt, 0, "Learning", profile!.version);

  const applied = await api.handleAiCleanupApply(undefined, {
    profile: { preferences: [], patterns: [], workflows: [] },
    acceptedMerged: [["pref_0", "pref_1"]],
    acceptedRemoved: ["pref_2"],
  });
  expect(applied).toEqual({ success: true, data: { applied: 2, skipped: 0 } });
  expect((await descriptions(manager)).sort()).toEqual(
    ["Learnt during the run", "Target and source"].sort()
  );
  // Apply clears the finished job.
  expect((await api.handleAiCleanupStatus(undefined)).data).toBeNull();
});

it("leaves the profile unchanged and asks to try again after three save conflicts", async () => {
  const { api, manager } = await setup();
  await api.handleAiCleanupStart(undefined, { includeIds: [] }, { callBatch });
  await settle(api);

  const racing = Object.create(manager) as typeof manager;
  let saves = 0;
  racing.getActiveProfile = async (user: string) => {
    const read = await manager.getActiveProfile(user);
    // Another session saves right after each read.
    await manager.updateProfile(read!.id, JSON.parse(read!.profileData), 0, "Race", read!.version);
    saves++;
    return read;
  };
  const before = await descriptions(manager);
  const result = await api.handleAiCleanupApply(
    undefined,
    { acceptedMerged: [["pref_0", "pref_1"]], acceptedRemoved: ["pref_2"] },
    { manager: racing }
  );
  expect(result).toEqual({
    success: false,
    error: "Profile saved at the same moment. Try Apply again.",
  });
  expect(saves).toBe(3);
  expect(await descriptions(manager)).toEqual(before);
  // The result stays for another try.
  expect((await api.handleAiCleanupStatus(undefined)).data?.status.state).toBe("done");
});

it("succeeds on the second attempt after one save conflict", async () => {
  const { api, manager } = await setup();
  await api.handleAiCleanupStart(undefined, { includeIds: [] }, { callBatch });
  await settle(api);

  const racing = Object.create(manager) as typeof manager;
  let reads = 0;
  racing.getActiveProfile = async (user: string) => {
    const read = await manager.getActiveProfile(user);
    if (++reads === 1) {
      await manager.updateProfile(
        read!.id,
        JSON.parse(read!.profileData),
        0,
        "Race",
        read!.version
      );
    }
    return read;
  };
  const result = await api.handleAiCleanupApply(
    undefined,
    { acceptedMerged: [], acceptedRemoved: ["pref_2"] },
    { manager: racing }
  );
  expect(result).toEqual({ success: true, data: { applied: 1, skipped: 0 } });
  expect(await descriptions(manager)).not.toContain("Stale");
});

it("reports no finished cleanup before a job is done", async () => {
  const { api } = await setup();
  const result = await api.handleAiCleanupApply(undefined, { acceptedRemoved: ["pref_2"] });
  expect(result).toEqual({
    success: false,
    error: "No finished cleanup found. Run AI cleanup again.",
  });
});

it("stops a job through the stop handler", async () => {
  const { api } = await setup();
  await api.handleAiCleanupStart(
    undefined,
    { includeIds: [] },
    {
      callBatch: () => new Promise(() => {}),
    }
  );
  expect((await api.handleAiCleanupStatus(undefined)).data?.status.state).toBe("running");
  expect(await api.handleAiCleanupStop(undefined)).toEqual({ success: true, data: null });
  expect((await api.handleAiCleanupStatus(undefined)).data).toBeNull();
});

it("redacts the configured API key from a failure", async () => {
  const { api } = await setup();
  const { CONFIG } = await import("../src/config.js");
  const original = CONFIG.memoryApiKey;
  CONFIG.memoryApiKey = "sk-test-secret-123456";
  try {
    await api.handleAiCleanupStart(
      undefined,
      { includeIds: [] },
      {
        callBatch: () => Promise.reject(new Error("bad key sk-test-secret-123456")),
      }
    );
    const done = await settle(api);
    expect(done.status.state).toBe("failed");
    expect(JSON.stringify(done)).not.toContain("sk-test-secret-123456");
  } finally {
    CONFIG.memoryApiKey = original;
  }
});
