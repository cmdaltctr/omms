import { describe, expect, it, mock } from "bun:test";

const logged: unknown[][] = [];
mock.module("../src/services/logger.js", () => ({
  log: (...args: unknown[]) => {
    logged.push(args);
  },
}));

const { checkAndNameGroups, GROUPS_PER_MODEL_CALL } =
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
