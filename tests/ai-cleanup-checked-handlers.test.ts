import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logged: unknown[][] = [];
mock.module("../src/services/logger.js", () => ({
  log: (...args: unknown[]) => logged.push(args),
}));

let directory: string;
const userId = "ai-cleanup-checked@example.invalid";

beforeEach(() => {
  logged.length = 0;
  directory = mkdtempSync(join(tmpdir(), "omms-ai-cleanup-checked-"));
});

afterEach(async () => {
  const { stopAiCleanupJob } = await import("../src/services/user-profile/ai-cleanup-job.js");
  stopAiCleanupJob(userId);
  await cleanupTursoTestDirectory(directory);
});

const item = (description: string, confidence: number, extra: object = {}) => ({
  category: "Style",
  description,
  confidence,
  frequency: 1,
  evidence: ["Evidence"],
  lastSeen: 123,
  ...extra,
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
  const raw = await import("../src/services/ai-cleanup-handlers.js");
  const config = await import("../src/config.js");
  const store = await import("../src/services/storage/profiles/ai-checked.js");
  const { aiCheckedKey } = await import("../src/services/user-profile/ai-cleanup-checked.js");
  const api = {
    start: (body: any, deps?: any) => raw.handleAiCleanupStart(undefined, body, config, deps),
    status: () => raw.handleAiCleanupStatus(undefined, config),
    stop: () => raw.handleAiCleanupStop(undefined, config),
    apply: (body: any) => raw.handleAiCleanupApply(undefined, body, config),
    checked: () => raw.handleAiCleanupChecked(undefined, config),
  };
  const manager = userProfileManager;
  const profile = (await manager.getActiveProfile(userId))!;
  const keyOf = (description: string, extra: object = {}) =>
    aiCheckedKey("preferences", item(description, 0, extra));
  const marks = async () => store.readAiCheckedKeys(profile.id);
  return { api, manager, profile, store, keyOf, marks };
}

/** A fake model that merges pref_1 into pref_0 and removes pref_2. Nothing is kept. */
function mergeAndRemove(mergedDescription = "Target and source") {
  return async () => ({
    diff: {
      kept: [],
      merged: [{ ids: ["pref_0", "pref_1"], result: mergedDescription }],
      removed: [{ id: "pref_2", reason: "dup" }],
    },
    mergedItems: { pref_0: { ...item(mergedDescription, 0.9), frequency: 2 } },
    checkedIds: [],
  });
}

async function settle(api: Awaited<ReturnType<typeof setup>>["api"]) {
  for (let i = 0; i < 200; i++) {
    const status = await api.status();
    if (status.data && status.data.status.state !== "running") return status.data;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}

async function runJob(ctx: Awaited<ReturnType<typeof setup>>, callBatch: () => Promise<unknown>) {
  await ctx.api.start({ includeIds: [], profileVersion: ctx.profile.version }, { callBatch });
  expect((await settle(ctx.api)).status.state).toBe("done");
}

describe("Apply marks", () => {
  it("marks the items of unticked merges, and not the items of ticked changes", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove());
    const applied = await ctx.api.apply({ acceptedMerged: [], acceptedRemoved: ["pref_2"] });
    expect(applied).toEqual({ success: true, data: { applied: 1, skipped: 0 } });
    expect([...(await ctx.marks())].sort()).toEqual(
      [ctx.keyOf("Target"), ctx.keyOf("Source")].sort()
    );
  });

  it("marks the item of an unticked removal", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove());
    await ctx.api.apply({ acceptedMerged: [["pref_0", "pref_1"]], acceptedRemoved: [] });
    expect([...(await ctx.marks())]).toEqual([ctx.keyOf("Stale")]);
  });

  it("deletes the mark of a ticked merge keeper whose text did not change", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove("Target"));
    await ctx.store.markAiChecked(ctx.profile.id, [ctx.keyOf("Target")]);
    await ctx.api.apply({ acceptedMerged: [["pref_0", "pref_1"]], acceptedRemoved: ["pref_2"] });
    expect([...(await ctx.marks())]).not.toContain(ctx.keyOf("Target"));
  });

  it("marks nothing for a ticked change that Apply skips", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove());
    // Learning edits Source before Apply, so the ticked merge cannot be found and is skipped.
    const data = JSON.parse(ctx.profile.profileData);
    data.preferences = data.preferences.map((p: any) =>
      p.description === "Source" ? { ...p, description: "Source, edited" } : p
    );
    await ctx.manager.updateProfile(ctx.profile.id, data, 0, "Learning", ctx.profile.version);
    const applied = await ctx.api.apply({
      acceptedMerged: [["pref_0", "pref_1"]],
      acceptedRemoved: ["pref_2"],
    });
    expect(applied).toEqual({ success: true, data: { applied: 1, skipped: 1 } });
    expect([...(await ctx.marks())]).toEqual([]);
  });

  it("does not fail Apply when the marks cannot be saved", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove());
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
    // A table of the wrong shape makes every write of a mark fail.
    await db.execute("DROP TABLE IF EXISTS profile_ai_checked");
    await db.execute("CREATE TABLE profile_ai_checked (other INTEGER)");
    const applied = await ctx.api.apply({ acceptedMerged: [], acceptedRemoved: ["pref_2"] });
    expect(applied).toEqual({ success: true, data: { applied: 1, skipped: 0 } });
    const text = JSON.stringify(logged);
    expect(text).toContain("AI cleanup apply: checked marks not saved");
    expect(text).not.toContain("Target");
  });

  it("keeps the marks written at job end when the user presses Back", async () => {
    const ctx = await setup();
    await runJob(ctx, async () => ({
      diff: { kept: ["Stale"], merged: [], removed: [] },
      mergedItems: {},
      checkedIds: ["pref_2"],
    }));
    expect([...(await ctx.marks())]).toEqual([ctx.keyOf("Stale")]);
    await ctx.api.stop();
    expect([...(await ctx.marks())]).toEqual([ctx.keyOf("Stale")]);
  });

  it("logs counts and no memory text", async () => {
    const ctx = await setup();
    await runJob(ctx, mergeAndRemove());
    await ctx.api.apply({ acceptedMerged: [], acceptedRemoved: ["pref_2"] });
    const text = JSON.stringify(logged);
    expect(text).toContain("AI cleanup apply: checked marks saved");
    for (const word of ["Target", "Source", "Stale", "Evidence"]) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toContain(ctx.keyOf("Target"));
  });
});

describe("the checked read", () => {
  it("returns the profile version and the position ids of checked items in the sorted profile", async () => {
    const ctx = await setup();
    await ctx.store.markAiChecked(ctx.profile.id, [ctx.keyOf("Source"), ctx.keyOf("Stale")]);
    expect(await ctx.api.checked()).toEqual({
      success: true,
      data: { profileVersion: ctx.profile.version, ids: ["pref_1", "pref_2"] },
    });
  });

  it("keeps the id of a reordered item at its new position", async () => {
    const ctx = await setup();
    await ctx.store.markAiChecked(ctx.profile.id, [ctx.keyOf("Source")]);
    const data = JSON.parse(ctx.profile.profileData);
    data.preferences = data.preferences.map((p: any) =>
      p.description === "Source" ? { ...p, confidence: 0.95 } : p
    );
    await ctx.manager.updateProfile(ctx.profile.id, data, 0, "Learning", ctx.profile.version);
    const result = await ctx.api.checked();
    expect(result.data!.ids).toEqual(["pref_0"]);
    expect(result.data!.profileVersion).toBe(ctx.profile.version + 1);
  });

  it("drops the id when the description, steps or category change, and keeps it for a new frequency", async () => {
    const changes: Array<[object, string[]]> = [
      [{ description: "Source, edited" }, []],
      [{ steps: ["one"] }, []],
      [{ category: "Testing" }, []],
      [{ category: "style" }, ["pref_1"]],
      [{ frequency: 7 }, ["pref_1"]],
    ];
    for (const [change, ids] of changes) {
      const ctx = await setup();
      await ctx.store.markAiChecked(ctx.profile.id, [ctx.keyOf("Source")]);
      const data = JSON.parse(ctx.profile.profileData);
      data.preferences = data.preferences.map((p: any) =>
        p.description === "Source" ? { ...p, ...change } : p
      );
      await ctx.manager.updateProfile(ctx.profile.id, data, 0, "Edit", ctx.profile.version);
      expect((await ctx.api.checked()).data!.ids).toEqual(ids);
      await cleanupTursoTestDirectory(directory);
      directory = mkdtempSync(join(tmpdir(), "omms-ai-cleanup-checked-"));
    }
  });

  it("gives an empty list when nothing is checked", async () => {
    const ctx = await setup();
    expect((await ctx.api.checked()).data).toEqual({
      profileVersion: ctx.profile.version,
      ids: [],
    });
  });

  it("gives an error reply when there is no profile", async () => {
    const ctx = await setup();
    await ctx.manager.deleteProfile(ctx.profile.id);
    expect(await ctx.api.checked()).toEqual({ success: false, error: "No profile found" });
  });
});
