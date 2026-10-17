import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

let directory: string;
const userId = "auto-cleanup-handlers@example.invalid";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-cleanup-handlers-"));
});

afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
});

const item = (description: string, extra: Record<string, unknown> = {}) => ({
  category: "Style",
  description,
  confidence: 0.8,
  frequency: 1,
  evidence: ["Evidence"],
  lastSeen: 123,
  ...extra,
});

async function setup(descriptions: string[]) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  userProfileManager.reset();
  await userProfileManager.createProfile(
    userId,
    "Test",
    "test",
    userId,
    { preferences: descriptions.map((d) => item(d)), patterns: [], workflows: [] },
    0
  );
  const profile = (await userProfileManager.getActiveProfile(userId))!;
  const api = await import("../src/services/auto-cleanup-handlers.js");
  const store = await import("../src/services/user-profile/auto-cleanup-store.js");
  return { api, store, manager: userProfileManager, profileId: profile.id };
}

async function descriptionsOf(manager: any): Promise<string[]> {
  const profile = await manager.getActiveProfile(userId);
  return JSON.parse(profile.profileData)
    .preferences.map((p: any) => p.description)
    .sort();
}

const mergeEntry = (originals: string[], merged: string) => ({
  kind: "merge" as const,
  section: "preferences" as const,
  originals: originals.map((d) => item(d)),
  merged: item(merged),
});

describe("auto cleanup status", () => {
  it("returns the newest open record with its counts, and no items", async () => {
    const { api, store, profileId } = await setup(["Target and source"]);
    await store.insertAutoCleanupRecord(
      profileId,
      { promptsAnalyzed: 100, merged: 4, removed: 3, entries: [mergeEntry(["a", "b"], "ab")] },
      Date.now()
    );
    const result = await api.handleAutoCleanupStatus(userId);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: expect.any(Number),
      createdAt: expect.any(Number),
      merged: 4,
      removed: 3,
    });
  });

  it("returns null when there is no record", async () => {
    const { api } = await setup(["One"]);
    expect(await api.handleAutoCleanupStatus(userId)).toEqual({ success: true, data: null });
  });
});

describe("auto cleanup undo", () => {
  it("restores the originals, keeps later learning and marks the record undone", async () => {
    const { api, store, manager, profileId } = await setup(["Target and source", "Learnt later"]);
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 100,
      merged: 1,
      removed: 1,
      entries: [
        mergeEntry(["Target", "Source"], "Target and source"),
        {
          kind: "remove",
          section: "preferences",
          original: item("Stale"),
        },
      ],
    });

    const result = await api.handleAutoCleanupUndo(userId);

    expect(result).toEqual({ success: true, data: { restored: 2, notFound: 0 } });
    expect(await descriptionsOf(manager)).toEqual(["Learnt later", "Source", "Stale", "Target"]);
    expect(await api.handleAutoCleanupStatus(userId)).toEqual({ success: true, data: null });
  });

  it("finds a merged item that the save stored under another spelling of its category", async () => {
    // The run wrote category "git workflow"; the save kept the label "Git workflow" that the profile uses.
    const { api, store, manager, profileId } = await setup([]);
    const profile = (await manager.getActiveProfile(userId))!;
    await manager.updateProfile(
      profile.id,
      {
        preferences: [
          { ...item("Merged result"), category: "Git workflow" },
          { ...item("Other"), category: "Git workflow" },
        ],
        patterns: [],
        workflows: [],
      } as never,
      0,
      "test",
      profile.version
    );
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 100,
      merged: 1,
      removed: 0,
      entries: [
        {
          kind: "merge",
          section: "preferences",
          originals: [
            { ...item("One"), category: "Git workflow" },
            { ...item("Two"), category: "git_workflow" },
          ],
          merged: { ...item("Merged result"), category: "git_workflow" },
        },
      ],
    });

    const result = await api.handleAutoCleanupUndo(userId);

    expect(result).toEqual({ success: true, data: { restored: 1, notFound: 0 } });
    expect(await descriptionsOf(manager)).toEqual(["One", "Other", "Two"]);
  });

  it("says there is nothing to undo when no record exists", async () => {
    const { api } = await setup(["One"]);
    expect(await api.handleAutoCleanupUndo(userId)).toEqual({
      success: false,
      error: "Nothing to undo.",
    });
  });

  it("reports changes it could not find and still marks the record undone", async () => {
    const { api, store, manager, profileId } = await setup(["Reworded by learning"]);
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 100,
      merged: 1,
      removed: 0,
      entries: [mergeEntry(["Target", "Source"], "Target and source")],
    });

    const result = await api.handleAutoCleanupUndo(userId);

    expect(result).toEqual({ success: true, data: { restored: 0, notFound: 1 } });
    expect(await descriptionsOf(manager)).toEqual(["Reworded by learning"]);
    expect((await api.handleAutoCleanupStatus(userId)).data).toBeNull();
  });

  it("acts on the next older record when asked a second time", async () => {
    const { api, store, manager, profileId } = await setup(["Newer merge", "Older merge"]);
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 100,
      merged: 1,
      removed: 0,
      entries: [mergeEntry(["Old one", "Old two"], "Older merge")],
    });
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 200,
      merged: 1,
      removed: 0,
      entries: [mergeEntry(["New one", "New two"], "Newer merge")],
    });

    expect((await api.handleAutoCleanupUndo(userId)).data).toEqual({ restored: 1, notFound: 0 });
    expect(await descriptionsOf(manager)).toEqual(["New one", "New two", "Older merge"]);
    expect((await api.handleAutoCleanupUndo(userId)).data).toEqual({ restored: 1, notFound: 0 });
    expect(await descriptionsOf(manager)).toEqual(["New one", "New two", "Old one", "Old two"]);
    expect((await api.handleAutoCleanupUndo(userId)).success).toBe(false);
  });

  it("tries a save conflict at most three times and then leaves the profile and the record", async () => {
    const { api, store, manager, profileId } = await setup(["Target and source"]);
    await store.insertAutoCleanupRecord(profileId, {
      promptsAnalyzed: 100,
      merged: 1,
      removed: 0,
      entries: [mergeEntry(["Target", "Source"], "Target and source")],
    });
    let saves = 0;
    const refusing = {
      getActiveProfile: (id: string) => manager.getActiveProfile(id),
      updateProfile: async () => {
        saves++;
        return false;
      },
    };

    const result = await api.handleAutoCleanupUndo(userId, { manager: refusing as never });

    expect(result).toEqual({
      success: false,
      error: "Profile saved at the same moment. Try Undo again.",
    });
    expect(saves).toBe(3);
    expect(await descriptionsOf(manager)).toEqual(["Target and source"]);
    expect((await api.handleAutoCleanupStatus(userId)).data).not.toBeNull();
  });
});
