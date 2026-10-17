import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logs: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data: unknown) => logs.push({ message, data }),
}));

let directory: string;
const userId = "auto-cleanup@example.invalid";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omms-auto-cleanup-"));
  logs.length = 0;
});

afterEach(async () => {
  const { registerHostProfileModel } =
    await import("../src/services/user-profile/profile-model.js");
  registerHostProfileModel(null);
  await cleanupTursoTestDirectory(directory);
});

const item = (description: string) => ({
  category: "Style",
  description,
  confidence: 0.8,
  frequency: 1,
  evidence: ["Evidence"],
  lastSeen: 123,
});

/** The named items first, then enough fillers that a few changes stay under the size limit. */
async function setup(named: string[], fillers = 0) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
  const { userProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  userProfileManager.reset();
  const descriptions = [...named, ...Array.from({ length: fillers }, (_, i) => `Filler ${i}`)];
  await userProfileManager.createProfile(
    userId,
    "Test",
    "test",
    userId,
    { preferences: descriptions.map(item), patterns: [], workflows: [] },
    0
  );
  const profile = (await userProfileManager.getActiveProfile(userId))!;
  const run = await import("../src/services/user-profile/auto-cleanup.js");
  const store = await import("../src/services/user-profile/auto-cleanup-store.js");
  return { run, store, manager: userProfileManager, profileId: profile.id };
}

async function descriptionsOf(manager: any): Promise<string[]> {
  const profile = await manager.getActiveProfile(userId);
  return JSON.parse(profile.profileData)
    .preferences.map((p: any) => p.description)
    .sort();
}

type Batch = { preferences: Array<{ id: string; description: string }> };

const idOf = (batch: Batch, description: string) =>
  batch.preferences.find((p) => p.description === description)?.id;

/** A fake model for one batch: merge Target and Source, remove Stale, when they are in it. */
async function mergeAndRemove(batch: Batch) {
  const target = idOf(batch, "Target");
  const source = idOf(batch, "Source");
  const stale = idOf(batch, "Stale");
  return {
    diff: {
      kept: [],
      merged: target && source ? [{ ids: [target, source], result: "Target and source" }] : [],
      removed: stale ? [{ id: stale, reason: "dup" }] : [],
    },
    mergedItems: target && source ? { [target]: item("Target and source") } : {},
  };
}

const nothing = async () => ({
  diff: { kept: [], merged: [], removed: [] },
  mergedItems: {},
});

describe("startAutoProfileCleanup", () => {
  it("sends every item in batches of at most 100", async () => {
    const { run } = await setup([], 250);
    const sizes: number[] = [];
    const ids: string[] = [];
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: async (batch: Batch) => {
        sizes.push(batch.preferences.length);
        ids.push(...batch.preferences.map((p) => p.id));
        return nothing();
      },
    });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(new Set(ids).size).toBe(250);
    expect(ids).toHaveLength(250);
    expect(result.status).toBe("nothing-to-change");
  });

  it("applies every proposed merge and removal and leaves one restore record", async () => {
    const { run, store, manager, profileId } = await setup(["Target", "Source", "Stale"], 20);
    const result = await run.startAutoProfileCleanup(userId, { callBatch: mergeAndRemove });

    expect(result).toMatchObject({ status: "applied", applied: 2, skipped: 0 });
    const after = await descriptionsOf(manager);
    expect(after).toContain("Target and source");
    expect(after).not.toContain("Target");
    expect(after).not.toContain("Source");
    expect(after).not.toContain("Stale");
    expect(after).toHaveLength(21);

    const record = await store.latestOpenAutoCleanup(profileId);
    expect(record).toMatchObject({ merged: 1, removed: 1 });
    expect(record!.entries).toHaveLength(2);
    expect(
      record!.entries.flatMap((e: any) => (e.kind === "merge" ? e.originals : [e.original]))
    ).toHaveLength(3);
  });

  it("leaves a failed batch unchanged and applies the others", async () => {
    const { run, manager } = await setup([], 30);
    let calls = 0;
    const result = await run.startAutoProfileCleanup(userId, {
      batchSize: 5,
      callBatch: async (batch: Batch) => {
        calls++;
        if (calls === 1) throw new Error("timeout");
        return {
          diff: { kept: [], merged: [], removed: [{ id: batch.preferences[0]!.id, reason: "x" }] },
          mergedItems: {},
        };
      },
    });
    expect(calls).toBe(6);
    expect(result.status).toBe("applied");
    expect(await descriptionsOf(manager)).toHaveLength(25);
  });

  it("changes nothing and leaves no record when every batch fails", async () => {
    const { run, store, manager, profileId } = await setup(["Target", "Source"], 5);
    const before = await descriptionsOf(manager);
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: async () => {
        throw new Error("boom");
      },
    });
    expect(result.status).toBe("failed");
    expect(await descriptionsOf(manager)).toEqual(before);
    expect(await store.latestOpenAutoCleanup(profileId)).toBeNull();
  });

  it("logs that no provider is set when there is no model at all", async () => {
    const { run, manager, store } = await setup(["One", "Two"]);
    const { CONFIG } = await import("../src/config.js");
    const saved = [CONFIG.memoryModel, CONFIG.memoryApiUrl];
    CONFIG.memoryModel = undefined;
    CONFIG.memoryApiUrl = undefined;
    try {
      const result = await run.startAutoProfileCleanup(userId, { store: manager });
      expect(result.status).toBe("failed");
    } finally {
      [CONFIG.memoryModel, CONFIG.memoryApiUrl] = saved;
    }
    expect(JSON.stringify(logs)).toContain("no-provider");
    expect(store).toBeDefined();
  });

  it("skips a profile with fewer than 2 items", async () => {
    const { run } = await setup(["Only one"]);
    let called = false;
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: async () => {
        called = true;
        return nothing();
      },
    });
    expect(result.status).toBe("too-few-items");
    expect(called).toBe(false);
  });

  it("reports no profile", async () => {
    const { run, manager } = await setup(["One", "Two"]);
    const result = await run.startAutoProfileCleanup("someone-else@example.invalid", {
      callBatch: nothing,
      store: manager,
    });
    expect(result.status).toBe("no-profile");
  });

  it("ignores a second start in the same process while one runs", async () => {
    const { run } = await setup(["One", "Two"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const callBatch = async () => {
      calls++;
      await gate;
      return nothing();
    };
    const first = run.startAutoProfileCleanup(userId, { callBatch });
    const second = await run.startAutoProfileCleanup(userId, { callBatch });
    expect(second.status).toBe("already-running");
    release();
    expect((await first).status).toBe("nothing-to-change");
    expect(calls).toBe(1);
    const third = await run.startAutoProfileCleanup(userId, { callBatch: nothing });
    expect(third.status).toBe("nothing-to-change");
  });

  it("logs codes and counts and no item text", async () => {
    const { run } = await setup(["Target", "Source", "Stale"], 20);
    await run.startAutoProfileCleanup(userId, { callBatch: mergeAndRemove });
    await run.startAutoProfileCleanup(userId, {
      callBatch: async () => {
        throw new Error("SECRET reply text");
      },
    });
    const text = JSON.stringify(logs);
    for (const secret of ["Target", "Source", "Stale", "Filler", "SECRET", "Evidence"]) {
      expect(text).not.toContain(secret);
    }
    expect(logs.some((l) => l.message.includes("auto cleanup"))).toBe(true);
  });
});

describe("startAutoProfileCleanup saves", () => {
  it("keeps an item that learning added during the run", async () => {
    const { run, manager } = await setup(["Target", "Source", "Stale"], 20);
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: async (batch: Batch) => {
        const profile = (await manager.getActiveProfile(userId))!;
        const data = JSON.parse(profile.profileData);
        data.preferences.push(item("Learnt during the run"));
        await manager.updateProfile(profile.id, data, 0, "learning", profile.version);
        return mergeAndRemove(batch);
      },
    });
    expect(result).toMatchObject({ status: "applied", applied: 2 });
    const after = await descriptionsOf(manager);
    expect(after).toContain("Learnt during the run");
    expect(after).toContain("Target and source");
  });

  it("keeps the stored wording of a kept item the model reworded", async () => {
    const { registerHostProfileModel } =
      await import("../src/services/user-profile/profile-model.js");
    const { run, manager } = await setup(["Target", "Source", "Outside"], 20);
    registerHostProfileModel((async () => ({
      complete: async (_system: string, prompt: string) => {
        const json = prompt.slice(
          prompt.indexOf("Current profile:\n") + "Current profile:\n".length,
          prompt.indexOf("\n\nReturn JSON only")
        );
        const items: Array<{ id: string; description: string }> = JSON.parse(json).preferences;
        const find = (d: string) => items.find((i) => i.description === d)!;
        const reworded = items
          .filter((i) => i.description !== "Source")
          .map((i) =>
            i.description === "Outside"
              ? { ...i, description: "Outside, reworded by the model" }
              : i.description === "Target"
                ? { ...i, description: "Target and source" }
                : i
          );
        return JSON.stringify({
          preferences: reworded,
          patterns: [],
          workflows: [],
          mapping: {
            kept: reworded.map((i) => i.id).filter((id) => id !== find("Target").id),
            merged: [[find("Target").id, find("Source").id]],
            removed: [],
          },
        });
      },
    })) as never);

    const result = await run.startAutoProfileCleanup(userId, {});

    expect(result).toMatchObject({ status: "applied", applied: 1 });
    const after = await descriptionsOf(manager);
    expect(after).toContain("Outside");
    expect(after).not.toContain("Outside, reworded by the model");
    expect(after).toContain("Target and source");
  });

  it("uses the model the host gives for the batches", async () => {
    const { run } = await setup(["One", "Two"]);
    const prompts: string[] = [];
    const model = {
      complete: async (_system: string, prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({
          preferences: [],
          patterns: [],
          workflows: [],
          mapping: { kept: [], merged: [], removed: [] },
        });
      },
    };
    const result = await run.startAutoProfileCleanup(userId, {
      resolveModel: () => model as never,
    });
    expect(prompts).toHaveLength(1);
    expect(result.status).toBe("nothing-to-change");
  });

  it("skips a merge whose item learning changed, with no duplicate and no record for it", async () => {
    const { run, store, manager, profileId } = await setup(["Target", "Source"], 20);
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: async (batch: Batch) => {
        const profile = (await manager.getActiveProfile(userId))!;
        const data = JSON.parse(profile.profileData);
        data.preferences.find((p: any) => p.description === "Source").description =
          "Source, reworded by learning";
        await manager.updateProfile(profile.id, data, 0, "learning", profile.version);
        return mergeAndRemove(batch);
      },
    });
    expect(result).toMatchObject({ status: "unchanged", skipped: 1 });
    const after = await descriptionsOf(manager);
    expect(after).toContain("Target");
    expect(after).toContain("Source, reworded by learning");
    expect(after).not.toContain("Target and source");
    expect(await store.latestOpenAutoCleanup(profileId)).toBeNull();
  });

  it("stores the record before the save and withdraws it when the save fails", async () => {
    const { run, store, manager, profileId } = await setup(["Target", "Source", "Stale"], 20);
    const seen: boolean[] = [];
    const refusing = {
      getActiveProfile: (id: string) => manager.getActiveProfile(id),
      updateProfile: async () => {
        seen.push((await store.latestOpenAutoCleanupSummary(profileId)) !== null);
        return false;
      },
    };
    const result = await run.startAutoProfileCleanup(userId, {
      callBatch: mergeAndRemove,
      store: refusing as never,
    });
    expect(result.status).toBe("conflict");
    expect(seen).toEqual([true, true, true]);
    expect(await store.latestOpenAutoCleanup(profileId)).toBeNull();
    expect(await descriptionsOf(manager)).toContain("Target");
  });

  it("leaves no record when the model proposes no change", async () => {
    const { run, store, profileId } = await setup(["Target", "Source"], 5);
    const result = await run.startAutoProfileCleanup(userId, { callBatch: nothing });
    expect(result.status).toBe("nothing-to-change");
    expect(await store.latestOpenAutoCleanup(profileId)).toBeNull();
  });
});

describe("startAutoProfileCleanup size limit", () => {
  const remove = (count: number) => async (batch: Batch) => ({
    diff: {
      kept: [],
      merged: [],
      removed: batch.preferences.slice(0, count).map((p) => ({ id: p.id, reason: "x" })),
    },
    mergedItems: {},
  });

  it("applies nothing when the model proposes to remove more than 25% of the items", async () => {
    const { run, store, manager, profileId } = await setup([], 8);
    const before = await descriptionsOf(manager);
    const result = await run.startAutoProfileCleanup(userId, { callBatch: remove(3) });
    expect(result.status).toBe("too-many-changes");
    expect(await descriptionsOf(manager)).toEqual(before);
    expect(await store.latestOpenAutoCleanup(profileId)).toBeNull();
    expect(JSON.stringify(logs)).toContain("too-many-changes");
  });

  it("applies exactly 25%", async () => {
    const { run, manager } = await setup([], 8);
    const result = await run.startAutoProfileCleanup(userId, { callBatch: remove(2) });
    expect(result).toMatchObject({ status: "applied", applied: 2 });
    expect(await descriptionsOf(manager)).toHaveLength(6);
  });

  it("counts the items merged into another item", async () => {
    const { run, manager } = await setup([], 8);
    const merge = (count: number) => async (batch: Batch) => ({
      diff: {
        kept: [],
        merged: [{ ids: batch.preferences.slice(0, count).map((p) => p.id), result: "merged" }],
        removed: [],
      },
      mergedItems: { [batch.preferences[0]!.id]: item("merged") },
    });
    // A group of 4 merges 3 items away, which is 37.5% of 8 items.
    expect((await run.startAutoProfileCleanup(userId, { callBatch: merge(4) })).status).toBe(
      "too-many-changes"
    );
    // A group of 3 merges 2 items away, which is 25%.
    expect((await run.startAutoProfileCleanup(userId, { callBatch: merge(3) })).status).toBe(
      "applied"
    );
    expect(await descriptionsOf(manager)).toHaveLength(6);
  });
});
