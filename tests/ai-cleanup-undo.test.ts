import { describe, expect, it } from "bun:test";
import { applyCleanupEdits } from "../src/services/user-profile/ai-cleanup-apply.js";
import type { RestoreEntry } from "../src/services/user-profile/ai-cleanup-apply.js";
import { undoCleanupEdits } from "../src/services/user-profile/ai-cleanup-undo.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";

function pref(description: string, extra: Record<string, unknown> = {}) {
  return { category: "style", description, confidence: 0.5, frequency: 1, ...extra } as any;
}

function profileOf(...descriptions: string[]): UserProfileData {
  return { preferences: descriptions.map((d) => pref(d)), patterns: [], workflows: [] };
}

function descriptions(profile: UserProfileData): string[] {
  return profile.preferences.map((p) => p.description).sort();
}

const mergeEntry = (originals: string[], merged: string): RestoreEntry => ({
  kind: "merge",
  section: "preferences",
  originals: originals.map((d) => pref(d)),
  merged: pref(merged, { frequency: 2 }),
});

const removeEntry = (description: string): RestoreEntry => ({
  kind: "remove",
  section: "preferences",
  original: pref(description),
});

describe("undoCleanupEdits", () => {
  it("restores a merge and a removal", () => {
    const current = profileOf("target and source", "kept");
    const result = undoCleanupEdits(current, [
      mergeEntry(["target", "source"], "target and source"),
      removeEntry("stale"),
    ]);
    expect(descriptions(result.profile)).toEqual(["kept", "source", "stale", "target"]);
    expect(result).toMatchObject({ restored: 2, notFound: 0 });
  });

  it("keeps items that learning added or updated after the run", () => {
    const current = profileOf("target and source", "learnt later");
    current.preferences[0]!.frequency = 9;
    const result = undoCleanupEdits(current, [
      mergeEntry(["target", "source"], "target and source"),
    ]);
    expect(descriptions(result.profile)).toEqual(["learnt later", "source", "target"]);
    expect(result.restored).toBe(1);
  });

  it("reports a merge as not found when learning rewrote the merged item, and adds no duplicate", () => {
    const current = profileOf("target and source, reworded by learning");
    const result = undoCleanupEdits(current, [
      mergeEntry(["target", "source"], "target and source"),
    ]);
    expect(descriptions(result.profile)).toEqual(["target and source, reworded by learning"]);
    expect(result).toMatchObject({ restored: 0, notFound: 1 });
  });

  it("does not add an original that is already in the profile", () => {
    // Learning created an item equal to the removed one.
    const current = profileOf("stale");
    const result = undoCleanupEdits(current, [removeEntry("stale")]);
    expect(descriptions(result.profile)).toEqual(["stale"]);
    expect(result).toMatchObject({ restored: 0, notFound: 1 });
  });

  it("leaves the merged item alone when one of its originals is already back", () => {
    const current = profileOf("target and source", "source");
    const result = undoCleanupEdits(current, [
      mergeEntry(["target", "source"], "target and source"),
    ]);
    expect(descriptions(result.profile)).toEqual(["source", "target and source"]);
    expect(result).toMatchObject({ restored: 0, notFound: 1 });
  });

  it("lets one item serve one change", () => {
    const current = profileOf("same result");
    const result = undoCleanupEdits(current, [
      mergeEntry(["a", "b"], "same result"),
      mergeEntry(["c", "d"], "same result"),
    ]);
    expect(descriptions(result.profile)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ restored: 1, notFound: 1 });
  });

  it("does not take an item restored by an earlier change as the merged item of a later one", () => {
    // The second change merged C and D into an item worded "a", which learning has since removed.
    const current = profileOf("result one");
    const result = undoCleanupEdits(current, [
      mergeEntry(["a", "b"], "result one"),
      mergeEntry(["c", "d"], "a"),
    ]);
    expect(descriptions(result.profile)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ restored: 1, notFound: 1 });
  });

  it("restores a merge whose result kept the wording of an original, with the original counters", () => {
    const current = profileOf("target");
    current.preferences[0]!.frequency = 7;
    const entry: RestoreEntry = {
      kind: "merge",
      section: "preferences",
      originals: [pref("target", { frequency: 3 }), pref("source")],
      merged: pref("target", { frequency: 7 }),
    };
    const result = undoCleanupEdits(current, [entry]);
    expect(descriptions(result.profile)).toEqual(["source", "target"]);
    expect(result.profile.preferences.find((p) => p.description === "target")?.frequency).toBe(3);
    expect(result.restored).toBe(1);
  });

  it("restores two identical originals of one merge", () => {
    const current = profileOf("merged");
    const result = undoCleanupEdits(current, [mergeEntry(["twin", "twin"], "merged")]);
    expect(descriptions(result.profile)).toEqual(["twin", "twin"]);
    expect(result.restored).toBe(1);
  });

  it("finds a merged item that learning updated, and restores the originals without the update", () => {
    // The docs say so: an update to a merged item is lost, other later learning stays.
    const current = profileOf("target and source", "learnt later");
    current.preferences[0]!.frequency = 9;
    const result = undoCleanupEdits(current, [
      mergeEntry(["target", "source"], "target and source"),
    ]);
    expect(result).toMatchObject({ restored: 1, notFound: 0 });
    expect(descriptions(result.profile)).toEqual(["learnt later", "source", "target"]);
    expect(result.profile.preferences.find((p) => p.description === "target")?.frequency).toBe(1);
    expect(result.profile.preferences.find((p) => p.description === "learnt later")).toBeDefined();
  });

  it("finds a merged item whose category spelling a later save rewrote", () => {
    // The save keeps one visible label for spellings of one category, so "code_style" became "Code style".
    const current = {
      preferences: [pref("merged", { category: "Code style" })],
      patterns: [],
      workflows: [],
    } as UserProfileData;
    const entry: RestoreEntry = {
      kind: "merge",
      section: "preferences",
      originals: [pref("one", { category: "Code style" }), pref("two", { category: "code_style" })],
      merged: pref("merged", { category: "code_style" }),
    };
    const result = undoCleanupEdits(current, [entry]);
    expect(descriptions(result.profile)).toEqual(["one", "two"]);
    expect(result).toMatchObject({ restored: 1, notFound: 0 });
  });

  it("sees an original that is already back under another spelling of its category", () => {
    const current = {
      preferences: [pref("stale", { category: "Code style" })],
      patterns: [],
      workflows: [],
    } as UserProfileData;
    const result = undoCleanupEdits(current, [
      {
        kind: "remove",
        section: "preferences",
        original: pref("stale", { category: "code_style" }),
      },
    ]);
    expect(descriptions(result.profile)).toEqual(["stale"]);
    expect(result).toMatchObject({ restored: 0, notFound: 1 });
  });

  it("restores into the section the entry names", () => {
    const wf = (description: string) => ({ category: "git", description, steps: ["a"] }) as any;
    const current: UserProfileData = { preferences: [], patterns: [], workflows: [wf("merged")] };
    const result = undoCleanupEdits(current, [
      {
        kind: "merge",
        section: "workflows",
        originals: [wf("one"), wf("two")],
        merged: wf("merged"),
      },
    ]);
    expect(result.profile.workflows.map((w: any) => w.description).sort()).toEqual(["one", "two"]);
    expect(result.profile.preferences).toEqual([]);
  });

  it("does not change the profile it was given", () => {
    const current = profileOf("target and source");
    const copy = structuredClone(current);
    undoCleanupEdits(current, [mergeEntry(["target", "source"], "target and source")]);
    expect(current).toEqual(copy);
  });

  it("reports nothing restored for an empty record", () => {
    const current = profileOf("a");
    expect(undoCleanupEdits(current, [])).toMatchObject({ restored: 0, notFound: 0 });
  });

  it("puts back exactly what applyCleanupEdits changed", () => {
    const stored = profileOf("target", "source", "stale", "outside");
    const job = {
      old: stored,
      changes: {
        kept: [],
        merged: [{ ids: ["pref_0", "pref_1"], result: "target and source" }],
        removed: [{ id: "pref_2", reason: "dup" }],
      },
      mergedItems: { pref_0: pref("target and source", { frequency: 2 }) },
    };
    const applied = applyCleanupEdits(structuredClone(stored), job, {
      merged: [["pref_0", "pref_1"]],
      removed: ["pref_2"],
    });
    expect(descriptions(applied.profile)).toEqual(["outside", "target and source"]);

    const undone = undoCleanupEdits(applied.profile, applied.restore);

    expect(descriptions(undone.profile)).toEqual(["outside", "source", "stale", "target"]);
    expect(undone).toMatchObject({ restored: 2, notFound: 0 });
  });
});
