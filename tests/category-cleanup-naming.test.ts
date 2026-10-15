import { describe, expect, it, mock, spyOn } from "bun:test";

const logged: unknown[][] = [];
mock.module("../src/services/logger.js", () => ({
  log: (...args: unknown[]) => {
    logged.push(args);
  },
}));

const { checkAndNameGroups, GROUPS_PER_MODEL_CALL, withTimeout } =
  await import("../src/services/user-profile/category-cleanup.js");

const group = (id: string, ...labels: [string, number][]) => ({
  id,
  labels: labels.map(([label, count]) => ({ label, count })),
});

const examples = new Map<string, string[]>([
  [
    "Execution",
    ["Works in the existing checkout", "Runs commands directly", "Avoids new worktrees", "Fourth"],
  ],
  ["Direct execution", ["Runs the command straight away"]],
  ["Execution speed", ["Wants fast builds"]],
]);

describe("checkAndNameGroups", () => {
  it("removes a label the model judges different and uses the model's name", async () => {
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2], ["Execution speed", 1])];
    const result = await checkAndNameGroups(groups, examples, async () => ({
      groups: [{ group: "g1", keep: ["Execution", "Direct execution"], name: "Execution style" }],
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.labels.map((entry) => entry.label)).toEqual([
      "Execution",
      "Direct execution",
    ]);
    expect(result[0]!.name).toBe("Execution style");
    expect(result[0]!.checked).toBe(true);
  });

  it("drops a group the model leaves with one label", async () => {
    const groups = [group("g1", ["Execution", 5], ["Execution speed", 1])];
    const result = await checkAndNameGroups(groups, examples, async () => ({
      groups: [{ group: "g1", keep: ["Execution"], name: "Execution" }],
    }));
    expect(result).toEqual([]);
  });

  it("ignores a kept label that is not in the group", async () => {
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2])];
    const result = await checkAndNameGroups(groups, examples, async () => ({
      groups: [
        { group: "g1", keep: ["Execution", "Direct execution", "Invented"], name: "Execution" },
      ],
    }));
    expect(result[0]!.labels.map((entry) => entry.label)).toEqual([
      "Execution",
      "Direct execution",
    ]);
  });

  it("falls back to the most used label, unchecked, when the call fails", async () => {
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2])];
    const result = await checkAndNameGroups(groups, examples, async () => {
      throw new Error("timeout");
    });
    expect(result[0]!.name).toBe("Execution");
    expect(result[0]!.checked).toBe(false);
    expect(result[0]!.labels).toHaveLength(2);
  });

  it("falls back for a group the reply leaves out, and when there is no model", async () => {
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2])];
    const missing = await checkAndNameGroups(groups, examples, async () => ({ groups: [] }));
    expect(missing[0]).toMatchObject({ name: "Execution", checked: false });
    const none = await checkAndNameGroups(groups, examples, null);
    expect(none[0]).toMatchObject({ name: "Execution", checked: false });
  });

  it("sends 20 groups per call, with names, counts and at most three examples per name", async () => {
    const groups = Array.from({ length: 45 }, (_, index) =>
      group(`g${index}`, ["Execution", 5], ["Direct execution", 2])
    );
    const prompts: string[] = [];
    await checkAndNameGroups(groups, examples, async (_system, prompt) => {
      prompts.push(prompt);
      return { groups: [] };
    });
    expect(GROUPS_PER_MODEL_CALL).toBe(20);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain('"count":5');
    expect(prompts[0]).toContain("Avoids new worktrees");
    expect(prompts[0]).not.toContain("Fourth");
  });

  it("calls the model one batch at a time and reports progress after each", async () => {
    const groups = Array.from({ length: 45 }, (_, index) =>
      group(`g${index}`, ["Execution", 5], ["Direct execution", 2])
    );
    let inFlight = 0;
    let most = 0;
    const progress: [number, number][] = [];
    const result = await checkAndNameGroups(
      groups,
      examples,
      async (_system, prompt) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        const ids = [...prompt.matchAll(/"group":"(g\d+)"/g)].map((match) => match[1]);
        return {
          groups: ids.map((id) => ({
            group: id,
            keep: ["Execution", "Direct execution"],
            name: id,
          })),
        };
      },
      (done, total) => progress.push([done, total])
    );
    expect(most).toBe(1);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(result.map((entry) => entry.name)).toEqual(groups.map((entry) => entry.id));
  });

  it("logs counts and outcome codes, never names or descriptions", async () => {
    logged.length = 0;
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2])];
    await checkAndNameGroups(groups, examples, async () => {
      throw new Error("Execution failed for Runs commands directly");
    });
    const text = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThan(0);
    expect(text).not.toContain("Execution");
    expect(text).not.toContain("Runs commands");
  });
});

describe("checkAndNameGroups with saved verdicts", () => {
  type Verdict = { keep: string[]; name: string | null };
  /** An in-memory stand-in for the verdict store, shared by successive runs. */
  const memory = (saved = new Map<string, Verdict>()) => {
    const events: string[] = [];
    return {
      saved,
      events,
      save: async (verdicts: Map<string, Verdict>) => {
        events.push(`save:${[...verdicts.keys()].join(",")}`);
        for (const [id, verdict] of verdicts) saved.set(id, verdict);
      },
    };
  };
  const idsIn = (prompt: string) =>
    [...prompt.matchAll(/"group":"([^"]+)"/g)].map((match) => match[1]!);
  const answerAll = (sent: string[][]) => async (_system: string, prompt: string) => {
    const ids = idsIn(prompt);
    sent.push(ids);
    return {
      groups: ids.map((id) => ({ group: id, keep: ["Execution", "Direct execution"], name: id })),
    };
  };
  const many = (count: number, prefix = "g") =>
    Array.from({ length: count }, (_, index) =>
      group(`${prefix}${index}`, ["Execution", 5], ["Direct execution", 2])
    );

  it("asks the model only about groups with no saved verdict", async () => {
    const cache = memory(
      new Map([
        ["g0", { keep: ["Execution", "Direct execution"], name: "Saved zero" }],
        ["g1", { keep: ["Execution", "Direct execution"], name: "Saved one" }],
      ])
    );
    const sent: string[][] = [];
    const result = await checkAndNameGroups(many(3), examples, answerAll(sent), undefined, cache);
    expect(sent).toEqual([["g2"]]);
    expect(result.map((entry) => entry.name)).toEqual(["Saved zero", "Saved one", "g2"]);
    expect(result.every((entry) => entry.checked)).toBe(true);
  });

  it("retries only the batches that failed", async () => {
    const cache = memory();
    const groups = many(40);
    let call = 0;
    await checkAndNameGroups(
      groups,
      examples,
      async (system, prompt) => {
        if (++call === 1) throw new Error("timeout");
        return answerAll([])(system, prompt);
      },
      undefined,
      cache
    );
    expect([...cache.saved.keys()].sort()).toEqual(
      groups
        .slice(20)
        .map((entry) => entry.id)
        .sort()
    );
    const sent: string[][] = [];
    const second = await checkAndNameGroups(groups, examples, answerAll(sent), undefined, cache);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(groups.slice(0, 20).map((entry) => entry.id));
    expect(second.every((entry) => entry.checked)).toBe(true);
  });

  it("saves after each batch, before the next call", async () => {
    const cache = memory();
    const groups = many(40);
    await checkAndNameGroups(
      groups,
      examples,
      async (system, prompt) => {
        cache.events.push("model");
        return answerAll([])(system, prompt);
      },
      undefined,
      cache
    );
    expect(cache.events.map((entry) => entry.split(":")[0])).toEqual([
      "model",
      "save",
      "model",
      "save",
    ]);
  });

  it("keeps the batches that returned when a later call throws", async () => {
    const cache = memory();
    const groups = many(40);
    let call = 0;
    await checkAndNameGroups(
      groups,
      examples,
      async (system, prompt) => {
        if (++call === 2) throw new Error("timeout");
        return answerAll([])(system, prompt);
      },
      undefined,
      cache
    );
    expect(cache.saved.size).toBe(20);
    expect(cache.saved.has("g0")).toBe(true);
    expect(cache.saved.has("g20")).toBe(false);
  });

  it("saves nothing for a missing reply, a bad reply or no model", async () => {
    const groups = [group("g1", ["Execution", 5], ["Direct execution", 2])];
    const cache = memory();
    await checkAndNameGroups(groups, examples, async () => ({ groups: [] }), undefined, cache);
    await checkAndNameGroups(
      groups,
      examples,
      async () => ({ groups: [{ group: "g1", keep: "Execution", name: "x" }] }),
      undefined,
      cache
    );
    await checkAndNameGroups(groups, examples, null, undefined, cache);
    expect(cache.saved.size).toBe(0);
    expect(cache.events).toEqual([]);
  });

  it("does not ask again about a label set the model dropped", async () => {
    const groups = [group("g1", ["Execution", 5], ["Execution speed", 1])];
    const cache = memory();
    const first = await checkAndNameGroups(
      groups,
      examples,
      async () => ({ groups: [{ group: "g1", keep: ["Execution"], name: "Execution" }] }),
      undefined,
      cache
    );
    expect(first).toEqual([]);
    let calls = 0;
    const second = await checkAndNameGroups(
      groups,
      examples,
      async () => {
        calls++;
        return { groups: [] };
      },
      undefined,
      cache
    );
    expect(calls).toBe(0);
    expect(second).toEqual([]);
  });

  it("asks again when the label set of a group changed", async () => {
    const { groupId } = await import("../src/services/user-profile/category-groups.js");
    const two = [
      { label: "Execution", count: 5 },
      { label: "Direct execution", count: 2 },
    ];
    const three = [...two, { label: "Execution speed", count: 1 }];
    const cache = memory();
    await checkAndNameGroups(
      [{ id: groupId(two), labels: two }],
      examples,
      answerAll([]),
      undefined,
      cache
    );
    const sent: string[][] = [];
    await checkAndNameGroups(
      [{ id: groupId(three), labels: three }],
      examples,
      answerAll(sent),
      undefined,
      cache
    );
    expect(sent).toEqual([[groupId(three)]]);
  });

  it("filters a saved label that is no longer in the group", async () => {
    const cache = memory(
      new Map([["g1", { keep: ["Execution", "Direct execution", "Gone"], name: "Saved" }]])
    );
    const result = await checkAndNameGroups(
      many(1)
        .slice(0, 1)
        .map((entry) => ({ ...entry, id: "g1" })),
      examples,
      null,
      undefined,
      cache
    );
    expect(result[0]!.labels.map((entry) => entry.label)).toEqual([
      "Execution",
      "Direct execution",
    ]);
    expect(result[0]!.name).toBe("Saved");
    expect(result[0]!.checked).toBe(true);
  });

  it("counts progress in the batches that will run", async () => {
    const groups = many(100);
    const cache = memory(
      new Map(
        groups
          .slice(0, 60)
          .map(
            (entry) => [entry.id, { keep: ["Execution", "Direct execution"], name: "S" }] as const
          )
      )
    );
    const progress: [number, number][] = [];
    await checkAndNameGroups(
      groups,
      examples,
      answerAll([]),
      (done, total) => progress.push([done, total]),
      cache
    );
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("goes straight to done when every group has a saved verdict", async () => {
    const groups = many(5);
    const cache = memory(
      new Map(
        groups.map(
          (entry) => [entry.id, { keep: ["Execution", "Direct execution"], name: "S" }] as const
        )
      )
    );
    let calls = 0;
    const progress: [number, number][] = [];
    const result = await checkAndNameGroups(
      groups,
      examples,
      async () => {
        calls++;
        return { groups: [] };
      },
      (done, total) => progress.push([done, total]),
      cache
    );
    expect(calls).toBe(0);
    expect(progress).toEqual([[0, 0]]);
    expect(result).toHaveLength(5);
  });
});

describe("withTimeout", () => {
  it("clears its timer when the work finishes first", async () => {
    const clear = spyOn(globalThis, "clearTimeout");
    const before = clear.mock.calls.length;
    expect(await withTimeout(Promise.resolve("done"), 60_000, "too slow")).toBe("done");
    expect(clear.mock.calls.length).toBeGreaterThan(before);
    clear.mockRestore();
  });

  it("clears its timer when the work fails first", async () => {
    const clear = spyOn(globalThis, "clearTimeout");
    const before = clear.mock.calls.length;
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 60_000, "too slow")
    ).rejects.toThrow("boom");
    expect(clear.mock.calls.length).toBeGreaterThan(before);
    clear.mockRestore();
  });

  it("rejects with its message when the work is too slow", async () => {
    await expect(withTimeout(new Promise(() => {}), 5, "category cleanup timeout")).rejects.toThrow(
      "category cleanup timeout"
    );
  });
});
