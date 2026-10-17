import { describe, expect, it } from "bun:test";
import { applyCleanupEdits } from "../src/services/user-profile/ai-cleanup-apply.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";

function pref(description: string, extra: Record<string, unknown> = {}) {
  return { category: "style", description, confidence: 0.5, frequency: 1, ...extra } as any;
}

function profileOf(...descriptions: string[]): UserProfileData {
  return { preferences: descriptions.map((d) => pref(d)), patterns: [], workflows: [] };
}

function descriptions(profile: UserProfileData): string[] {
  return profile.preferences.map((p) => p.description);
}

// The job read this profile; its ids are positions in it.
const old = profileOf("target", "source", "stale", "reworded-by-model", "outside");
const job = {
  old,
  changes: {
    kept: ["reworded-by-model", "outside"],
    merged: [{ ids: ["pref_0", "pref_1"], result: "target merged" }],
    removed: [{ id: "pref_2", reason: "dup" }],
  },
  mergedItems: { pref_0: pref("target merged", { frequency: 2 }) },
};

describe("applyCleanupEdits", () => {
  it("applies a ticked removal and a ticked merge", () => {
    const result = applyCleanupEdits(structuredClone(old), job, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_2"],
    });
    expect(descriptions(result.profile)).toEqual(["target merged", "reworded-by-model", "outside"]);
    expect(result.profile.preferences[0]?.frequency).toBe(2);
    expect(result).toMatchObject({ applied: 2, skipped: 0 });
  });

  it("does nothing for unticked changes", () => {
    const result = applyCleanupEdits(structuredClone(old), job, { merged: [], removed: [] });
    expect(result.profile).toEqual(old);
    expect(result).toMatchObject({ applied: 0, skipped: 0 });
  });

  it("keeps the stored wording of an item the model kept with new wording", () => {
    // The model's rewording is never shown for review, so the job holds no copy of it.
    const result = applyCleanupEdits(structuredClone(old), job, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_2"],
    });
    expect(descriptions(result.profile)).toContain("reworded-by-model");
  });

  it("keeps an item that learning added during the run", () => {
    const current = structuredClone(old);
    current.preferences.unshift(pref("learnt during the run"));
    const result = applyCleanupEdits(current, job, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_2"],
    });
    expect(descriptions(result.profile)).toEqual([
      "learnt during the run",
      "target merged",
      "reworded-by-model",
      "outside",
    ]);
  });

  it("matches a selected item whose frequency learning raised", () => {
    const current = structuredClone(old);
    current.preferences[2]!.frequency = 9;
    current.preferences[2]!.confidence = 0.9;
    const result = applyCleanupEdits(current, job, { merged: [], removed: ["pref_2"] });
    expect(descriptions(result.profile)).not.toContain("stale");
    expect(result).toMatchObject({ applied: 1, skipped: 0 });
  });

  it("skips a ticked merge whose item learning reworded, with no duplicate", () => {
    const current = structuredClone(old);
    current.preferences[1]!.description = "source, reworded by learning";
    const result = applyCleanupEdits(current, job, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_2"],
    });
    expect(descriptions(result.profile)).toEqual([
      "target",
      "source, reworded by learning",
      "reworded-by-model",
      "outside",
    ]);
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
  });

  it("removes one occurrence for each ticked id when descriptions are duplicated", () => {
    const dupOld = profileOf("duplicate", "duplicate", "outside");
    const dupJob = {
      old: dupOld,
      changes: { kept: [], merged: [], removed: [{ id: "pref_1", reason: "dup" }] },
      mergedItems: {},
    };
    const result = applyCleanupEdits(structuredClone(dupOld), dupJob, { removed: ["pref_1"] });
    expect(descriptions(result.profile)).toEqual(["duplicate", "outside"]);
  });

  it("merges two items with the same description into one", () => {
    const dupOld = profileOf("duplicate", "duplicate", "outside");
    const dupJob = {
      old: dupOld,
      changes: {
        kept: [],
        merged: [{ ids: ["pref_0", "pref_1"], result: "duplicate" }],
        removed: [],
      },
      mergedItems: { pref_0: pref("duplicate", { frequency: 2 }) },
    };
    const result = applyCleanupEdits(structuredClone(dupOld), dupJob, {
      merged: [["pref_0", "pref_1"]],
    });
    expect(descriptions(result.profile)).toEqual(["duplicate", "outside"]);
    expect(result.profile.preferences[0]?.frequency).toBe(2);
  });

  it("counts a ticked removal of an item learning deleted as skipped", () => {
    const current = structuredClone(old);
    current.preferences.splice(2, 1);
    const result = applyCleanupEdits(current, job, { removed: ["pref_2"] });
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect(descriptions(result.profile)).toEqual(descriptions(current));
  });

  it("ignores ids that are not changes of the job", () => {
    const result = applyCleanupEdits(structuredClone(old), job, {
      merged: [["pref_3", "pref_4"]],
      removed: ["pref_4"],
    });
    expect(result.profile).toEqual(old);
    expect(result).toMatchObject({ applied: 0, skipped: 0 });
  });

  it("skips a removal of an item that a ticked merge already used", () => {
    const overlapJob = {
      ...job,
      changes: { ...job.changes, removed: [{ id: "pref_1", reason: "x" }] },
    };
    const result = applyCleanupEdits(structuredClone(old), overlapJob, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_1"],
    });
    expect(descriptions(result.profile)).toEqual([
      "target merged",
      "stale",
      "reworded-by-model",
      "outside",
    ]);
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
  });

  it("does not remove the merged item when a ticked removal names a used duplicate", () => {
    const dupOld = profileOf("duplicate", "duplicate", "outside");
    const dupJob = {
      old: dupOld,
      changes: {
        kept: [],
        merged: [{ ids: ["pref_0", "pref_1"], result: "duplicate" }],
        removed: [{ id: "pref_1", reason: "dup" }],
      },
      mergedItems: { pref_0: pref("duplicate", { frequency: 2 }) },
    };
    const result = applyCleanupEdits(structuredClone(dupOld), dupJob, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_1"],
    });
    expect(descriptions(result.profile)).toEqual(["duplicate", "outside"]);
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
  });

  it("matches workflows by their steps as well", () => {
    const wf = (steps: string[]) => ({ description: "release", steps, frequency: 1 }) as any;
    const wfOld: UserProfileData = {
      preferences: [],
      patterns: [],
      workflows: [wf(["build", "tag"]), wf(["build", "publish"])],
    };
    const wfJob = {
      old: wfOld,
      changes: { kept: [], merged: [], removed: [{ id: "wf_1", reason: "dup" }] },
      mergedItems: {},
    };
    const result = applyCleanupEdits(structuredClone(wfOld), wfJob, { removed: ["wf_1"] });
    expect(result.profile.workflows.map((w) => w.steps)).toEqual([["build", "tag"]]);
  });

  it("does not change the profile it was given", () => {
    const current = structuredClone(old);
    applyCleanupEdits(current, job, { merged: [["pref_0", "pref_1"]], removed: ["pref_2"] });
    expect(current).toEqual(old);
  });
});
