import { describe, expect, it, mock } from "bun:test";

mock.module("../src/services/logger.js", () => ({ log: () => {} }));

const { aiCheckedKey, keptIdsOfBatch, aiCheckedKeysForIds, marksAfterApply } =
  await import("../src/services/user-profile/ai-cleanup-checked.js");

const base = {
  category: "git_workflow",
  description: "Rebases before a pull request",
  steps: ["fetch", "rebase"],
  frequency: 2,
  evidence: ["one"],
  lastSeen: 10,
};

describe("aiCheckedKey", () => {
  it("is the same for two spellings of one category", () => {
    expect(aiCheckedKey("preferences", base)).toBe(
      aiCheckedKey("preferences", { ...base, category: "Git workflow" })
    );
  });

  it("changes with description, steps, category and section", () => {
    const key = aiCheckedKey("preferences", base);
    expect(aiCheckedKey("preferences", { ...base, description: "Merges" })).not.toBe(key);
    expect(aiCheckedKey("preferences", { ...base, steps: ["fetch"] })).not.toBe(key);
    expect(aiCheckedKey("preferences", { ...base, category: "testing" })).not.toBe(key);
    expect(aiCheckedKey("patterns", base)).not.toBe(key);
  });

  it("does not change with frequency, evidence or lastSeen", () => {
    const key = aiCheckedKey("preferences", base);
    expect(aiCheckedKey("preferences", { ...base, frequency: 3 })).toBe(key);
    expect(aiCheckedKey("preferences", { ...base, evidence: ["two"] })).toBe(key);
    expect(aiCheckedKey("preferences", { ...base, lastSeen: 99 })).toBe(key);
  });

  it("is 64 hex characters and holds no description text", () => {
    const key = aiCheckedKey("preferences", base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("Rebases");
  });
});

const batchOf = (n: number) => ({
  preferences: Array.from({ length: n }, (_, i) => ({ id: `pref_${i}`, description: `d${i}` })),
  patterns: [],
  workflows: [],
});

describe("keptIdsOfBatch", () => {
  it("returns the ids that the mapping neither merges nor removes", () => {
    const batch = batchOf(100);
    const mapping = {
      kept: [],
      merged: [
        ["pref_0", "pref_1"],
        ["pref_2", "pref_3"],
        ["pref_4", "pref_5"],
      ],
      removed: ["pref_6", "pref_7", "pref_8", "pref_9"],
    };
    const kept = keptIdsOfBatch(batch, mapping, true);
    expect(kept).toHaveLength(90);
    expect(kept).not.toContain("pref_0");
    expect(kept).not.toContain("pref_9");
    expect(kept).toContain("pref_10");
  });

  it("counts ids missing from the mapping as kept", () => {
    expect(keptIdsOfBatch(batchOf(3), { kept: ["pref_0"], merged: [], removed: [] }, true)).toEqual(
      ["pref_0", "pref_1", "pref_2"]
    );
  });

  it("leaves out every id of a merge group of three", () => {
    const mapping = { kept: [], merged: [["pref_0", "pref_1", "pref_2"]], removed: [] };
    expect(keptIdsOfBatch(batchOf(4), mapping, true)).toEqual(["pref_3"]);
  });

  it("returns none when the mapping is not valid", () => {
    expect(keptIdsOfBatch(batchOf(4), { kept: [], merged: [], removed: [] }, false)).toEqual([]);
  });
});

describe("aiCheckedKeysForIds", () => {
  it("turns position ids into keys of the profile the model saw", () => {
    const profile = {
      preferences: [base, { ...base, description: "other" }],
      patterns: [{ ...base, description: "pattern" }],
      workflows: [],
    } as any;
    expect(aiCheckedKeysForIds(profile, ["pref_1", "pat_0", "wf_4", "bad"])).toEqual([
      aiCheckedKey("preferences", profile.preferences[1]),
      aiCheckedKey("patterns", profile.patterns[0]),
    ]);
  });
});

describe("marksAfterApply", () => {
  it("unmarks the saved item of a ticked merge when it takes another member's text", () => {
    const keeper = { ...base, description: "Keeper" };
    const other = { ...base, description: "Other" };
    const job = {
      old: { preferences: [keeper, other], patterns: [], workflows: [] } as any,
      changes: { kept: [], merged: [{ ids: ["pref_0", "pref_1"], result: "Other" }], removed: [] },
      // The model's cleaned text for the group is the second member's text.
      mergedItems: { pref_0: { ...other, frequency: 3 } },
    };
    const { unmark } = marksAfterApply(job, { merged: [["pref_0", "pref_1"]] });
    expect(unmark).toContain(aiCheckedKey("preferences", keeper));
    expect(unmark).toContain(aiCheckedKey("preferences", other));
  });
});
