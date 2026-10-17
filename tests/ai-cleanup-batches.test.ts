import { describe, expect, it, mock } from "bun:test";

const logged: Array<{ message: string; data: unknown }> = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data: unknown) => logged.push({ message, data }),
}));

const { splitIntoBatches, runInBatches } =
  await import("../src/services/user-profile/ai-cleanup-batches.js");

type Item = { id: string; category?: string; description: string };
type Indexed = { preferences: Item[]; patterns: Item[]; workflows: Item[] };

function items(prefix: string, categories: string[]): Item[] {
  return categories.map((category, i) => ({
    id: `${prefix}_${i}`,
    category,
    description: `secret text ${prefix} ${i}`,
  }));
}

function profile(parts: Partial<Indexed>): Indexed {
  return { preferences: [], patterns: [], workflows: [], ...parts };
}

function idsOf(batch: Indexed): string[] {
  return [...batch.preferences, ...batch.patterns, ...batch.workflows].map((it) => it.id);
}

function sectionsOf(batch: Indexed): string[] {
  return (["preferences", "patterns", "workflows"] as const).filter((s) => batch[s].length > 0);
}

describe("splitIntoBatches", () => {
  it("puts at most `size` items in a batch and every item in exactly one batch", () => {
    const input = profile({
      preferences: items(
        "pref",
        Array.from({ length: 250 }, (_, i) => `c${i % 7}`)
      ),
      patterns: items(
        "pat",
        Array.from({ length: 120 }, (_, i) => `p${i % 3}`)
      ),
    });
    const batches = splitIntoBatches(input, 100);
    for (const batch of batches) expect(idsOf(batch).length).toBeLessThanOrEqual(100);
    const all = batches.flatMap(idsOf);
    expect(all).toHaveLength(370);
    expect(new Set(all).size).toBe(370);
  });

  it("never mixes sections in one batch", () => {
    const input = profile({
      preferences: items("pref", Array(60).fill("a")),
      patterns: items("pat", Array(30).fill("a")),
    });
    const batches = splitIntoBatches(input, 100);
    expect(batches).toHaveLength(2);
    for (const batch of batches) expect(sectionsOf(batch)).toHaveLength(1);
  });

  it("keeps a category of 100 or fewer items in one batch", () => {
    // 500 preferences: the 30 "shared" items are spread through the list.
    const categories = Array.from({ length: 500 }, (_, i) => (i % 16 === 0 ? "Shared" : `c${i}`));
    const input = profile({ preferences: items("pref", categories) });
    const sharedIds = input.preferences.filter((p) => p.category === "Shared").map((p) => p.id);
    expect(sharedIds.length).toBeGreaterThanOrEqual(30);
    const batches = splitIntoBatches(input, 100);
    const holding = batches.filter((b) => idsOf(b).some((id) => sharedIds.includes(id)));
    expect(holding).toHaveLength(1);
    expect(sharedIds.every((id) => idsOf(holding[0]!).includes(id))).toBe(true);
  });

  it("treats categories case-insensitively when grouping", () => {
    // A case-sensitive sort would put "Hooks" between "Git" and "git" and split them.
    const input = profile({
      preferences: [
        ...items("pref", Array(95).fill("Hooks")),
        { id: "pref_95", category: "Git", description: "a" },
        { id: "pref_96", category: "git", description: "b" },
        { id: "pref_97", category: "GIT", description: "c" },
        { id: "pref_98", category: "Git", description: "d" },
        { id: "pref_99", category: "git", description: "e" },
        { id: "pref_100", category: "Git", description: "f" },
      ],
    });
    const batches = splitIntoBatches(input, 100);
    const git = ["pref_95", "pref_96", "pref_97", "pref_98", "pref_99", "pref_100"];
    expect(batches.filter((b) => idsOf(b).some((id) => git.includes(id)))).toHaveLength(1);
  });

  it("cuts a category of more than `size` items into chunks of `size`", () => {
    const input = profile({ workflows: items("wf", Array(230).fill("big")) });
    const batches = splitIntoBatches(input, 100);
    expect(batches.map((b) => idsOf(b).length)).toEqual([100, 100, 30]);
  });

  it("sends a small selection as one batch", () => {
    const input = profile({ preferences: items("pref", Array(40).fill("a")) });
    expect(splitIntoBatches(input, 100)).toHaveLength(1);
  });

  it("returns no batches for an empty selection", () => {
    expect(splitIntoBatches(profile({}), 100)).toEqual([]);
  });
});

function batchOf(ids: string[]): Indexed {
  return profile({ preferences: ids.map((id) => ({ id, category: "c", description: id })) });
}

function resultFor(batch: Indexed, extra: Partial<{ merged: string[][]; removed: string[] }> = {}) {
  const ids = idsOf(batch);
  const merged = extra.merged ?? [];
  const removed = extra.removed ?? [];
  return {
    cleaned: { preferences: [], patterns: [], workflows: [] },
    diff: {
      kept: ids,
      merged: merged.map((group) => ({ ids: group, result: `merged ${group[0]}` })),
      removed: removed.map((id) => ({ id, reason: "dup" })),
    },
    mergedItems: Object.fromEntries(
      merged.map((group) => [group[0]!, { category: "c", description: `merged ${group[0]}` }])
    ),
  };
}

describe("runInBatches", () => {
  it("joins the results of every batch", async () => {
    const batches = [batchOf(["pref_0", "pref_1"]), batchOf(["pref_2", "pref_3"])];
    const progress: number[] = [];
    const result = await runInBatches(batches, {
      callBatch: async (batch: Indexed) =>
        idsOf(batch)[0] === "pref_0"
          ? resultFor(batch, { merged: [["pref_0", "pref_1"]] })
          : resultFor(batch, { removed: ["pref_3"] }),
      onProgress: (done: number) => progress.push(done),
    });
    expect(result!.diff.merged.map((m) => m.ids)).toEqual([["pref_0", "pref_1"]]);
    expect(result!.diff.removed.map((r) => r.id)).toEqual(["pref_3"]);
    expect(Object.keys(result!.mergedItems)).toEqual(["pref_0"]);
    expect(result!.failedBatches).toBe(0);
    expect(result!.failedItems).toBe(0);
    expect(progress).toEqual([1, 2]);
  });

  it("keeps the items of a failed batch and counts it", async () => {
    const batches = [batchOf(["pref_0", "pref_1"]), batchOf(["pref_2", "pref_3", "pref_4"])];
    const failures: number[] = [];
    const result = await runInBatches(batches, {
      callBatch: async (batch: Indexed) => {
        if (idsOf(batch)[0] === "pref_2") {
          const error = new Error("The operation was aborted due to timeout");
          error.name = "TimeoutError";
          throw error;
        }
        return resultFor(batch, { removed: ["pref_1"] });
      },
      onProgress: (_done: number, _total: number, failed: number) => failures.push(failed),
    });
    expect(result!.failedBatches).toBe(1);
    expect(result!.failedItems).toBe(3);
    expect(result!.diff.removed.map((r) => r.id)).toEqual(["pref_1"]);
    const allIds = [
      ...result!.diff.merged.flatMap((m) => m.ids),
      ...result!.diff.removed.map((r) => r.id),
    ];
    expect(allIds.some((id) => ["pref_2", "pref_3", "pref_4"].includes(id))).toBe(false);
    expect(failures).toEqual([0, 1]);
  });

  it("throws the first error when every batch fails", async () => {
    let call = 0;
    await expect(
      runInBatches([batchOf(["pref_0"]), batchOf(["pref_1"])], {
        callBatch: async () => {
          call++;
          throw new Error(`failure ${call}`);
        },
      })
    ).rejects.toThrow("failure 1");
  });

  it("stops before the next batch and returns nothing", async () => {
    let stopped = false;
    const called: string[] = [];
    const result = await runInBatches(
      [batchOf(["pref_0"]), batchOf(["pref_1"]), batchOf(["pref_2"])],
      {
        callBatch: async (batch: Indexed) => {
          called.push(idsOf(batch)[0]!);
          stopped = true;
          return resultFor(batch);
        },
        isStopped: () => stopped,
      }
    );
    expect(result).toBeNull();
    expect(called).toEqual(["pref_0"]);
  });

  it("discards the result of the batch in progress when stopped during the last batch", async () => {
    let stopped = false;
    const result = await runInBatches([batchOf(["pref_0"])], {
      callBatch: async (batch: Indexed) => {
        stopped = true;
        return resultFor(batch, { removed: ["pref_0"] });
      },
      isStopped: () => stopped,
    });
    expect(result).toBeNull();
  });

  it("logs batch failures with a reason code and no item text", async () => {
    logged.length = 0;
    const failWith = (error: Error) => async () => {
      throw error;
    };
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const http = new Error("API request failed: 503 Service Unavailable");
    const invalid = new SyntaxError("Unexpected token");
    const other = new Error("boom");
    for (const error of [timeout, http, invalid, other]) {
      await runInBatches([batchOf(["pref_0"]), batchOf(["pref_1"])], {
        callBatch: async (batch: Indexed) =>
          idsOf(batch)[0] === "pref_0" ? failWith(error)() : resultFor(batch),
      });
    }
    const reasons = logged
      .filter((entry) => entry.message === "AI cleanup: batch failed")
      .map((entry) => (entry.data as { reason: string }).reason);
    expect(reasons).toEqual(["timeout", "http-503", "invalid-reply", "error"]);
    const text = JSON.stringify(logged);
    expect(text).not.toContain("secret text");
    expect(text).not.toContain("pref_0");
  });
});
