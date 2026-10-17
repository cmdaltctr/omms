import { describe, expect, it } from "bun:test";
import { applyCleanupEdits } from "../src/services/user-profile/ai-cleanup-apply.js";
import { rebuildProfileUsing } from "../src/services/user-profile/ai-cleanup.js";
import type { UserProfileData } from "../src/services/user-profile/types.js";

function pref(description: string, category = "style") {
  return {
    category,
    description,
    confidence: 0.5,
    evidence: ["e1"],
  };
}

function baseProfile(descriptions: string[]): UserProfileData {
  return {
    preferences: descriptions.map((d) => pref(d)),
    patterns: [],
    workflows: [],
  };
}

function jobFor(
  old: UserProfileData,
  changes: { merged?: Array<{ ids: string[]; result: string }>; removed?: string[] }
) {
  const merged = changes.merged ?? [];
  return {
    old,
    changes: {
      kept: [],
      merged,
      removed: (changes.removed ?? []).map((id) => ({ id, reason: "dup" })),
    },
    mergedItems: Object.fromEntries(merged.map((m) => [m.ids[0]!, pref(m.result)])),
  };
}

describe("applyCleanupEdits (#237)", () => {
  it("preserves unselected items when applying a scoped cleanup", () => {
    const oldProfile = baseProfile([
      "keep-0",
      "keep-1",
      "scope-a",
      "scope-b",
      "keep-4",
      "keep-5",
      "keep-6",
      "keep-7",
      "keep-8",
      "keep-9",
    ]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { merged: [{ ids: ["pref_2", "pref_3"], result: "scope-a-merged" }] }),
      { merged: [["pref_2", "pref_3"]], removed: [] }
    );

    const descs = profile.preferences.map((p) => p.description);
    expect(descs).toContain("keep-0");
    expect(descs).toContain("keep-9");
    expect(descs).toContain("scope-a-merged");
    expect(descs).not.toContain("scope-a");
    expect(descs).not.toContain("scope-b");
    expect(descs.filter((d) => d.startsWith("keep-"))).toHaveLength(8);
  });

  it("restores items when a removal is rejected", () => {
    const oldProfile = baseProfile(["keep", "remove-me"]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { removed: ["pref_1"] }),
      { merged: [], removed: [] } // removal rejected
    );

    const descs = profile.preferences.map((p) => p.description);
    expect(descs).toContain("keep");
    expect(descs).toContain("remove-me");
  });

  it("removes items when a removal is accepted", () => {
    const oldProfile = baseProfile(["keep", "remove-me", "outside"]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { removed: ["pref_1"] }),
      { merged: [], removed: ["pref_1"] }
    );

    const descs = profile.preferences.map((p) => p.description);
    expect(descs).toContain("keep");
    expect(descs).toContain("outside");
    expect(descs).not.toContain("remove-me");
  });

  it("restores merge sources when a merge is rejected", () => {
    const oldProfile = baseProfile(["target", "source", "outside"]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { merged: [{ ids: ["pref_0", "pref_1"], result: "target-merged" }] }),
      { merged: [], removed: [] } // merge rejected
    );

    const descs = profile.preferences.map((p) => p.description);
    expect(descs).toContain("outside");
    expect(descs).toContain("source");
    expect(descs).toContain("target");
    expect(descs).not.toContain("target-merged");
  });

  it("preserves items added after analysis and keeps the stored wording of kept items", () => {
    // Before the ai-cleanup-batching change, a kept item took the model's unreviewed wording
    // ("scope-a-clean"). Apply now changes only the items of ticked changes.
    const oldProfile = baseProfile(["scope-a", "keep"]);
    const currentProfile = baseProfile(["scope-a", "keep", "brand-new"]);

    const { profile } = applyCleanupEdits(currentProfile, jobFor(oldProfile, {}), {
      merged: [],
      removed: [],
    });

    const descs = profile.preferences.map((p) => p.description);
    expect(descs).toEqual(["scope-a", "keep", "brand-new"]);
  });

  it("changes only ticked items when the whole profile was selected", () => {
    // Replaces "replaces the full profile when includeIds is unset": an empty selection
    // now means every item, and Apply still changes only the items of ticked changes.
    const oldProfile = baseProfile(["a", "b", "c"]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { removed: ["pref_1", "pref_2"] }),
      { merged: [], removed: ["pref_1"] }
    );

    expect(profile.preferences.map((p) => p.description)).toEqual(["a", "c"]);
  });

  it("removes only the selected occurrence when descriptions are duplicated", () => {
    // Was a kept-item rewording of one duplicate; now a ticked removal of one duplicate.
    const oldProfile = baseProfile(["duplicate", "duplicate", "outside"]);

    const { profile } = applyCleanupEdits(
      structuredClone(oldProfile),
      jobFor(oldProfile, { removed: ["pref_0"] }),
      { merged: [], removed: ["pref_0"] }
    );

    expect(profile.preferences.map((p) => p.description)).toEqual(["duplicate", "outside"]);
  });

  it("restores a rejected merge without duplicating items whose derived metadata changed", () => {
    const oldProfile = baseProfile(["duplicate", "duplicate", "outside"]);
    oldProfile.preferences[1]!.centroid = [0.1, 0.2];
    const currentProfile = structuredClone(oldProfile);
    currentProfile.preferences[1]!.centroid = undefined;

    const { profile } = applyCleanupEdits(
      currentProfile,
      jobFor(oldProfile, { merged: [{ ids: ["pref_0", "pref_1"], result: "duplicate" }] }),
      { merged: [], removed: [] }
    );

    expect(profile.preferences).toHaveLength(3);
    expect(profile.preferences.filter((p) => p.description === "duplicate")).toHaveLength(2);
    expect(profile.preferences.map((p) => p.description)).toContain("outside");
  });

  it("applies an accepted merge to items whose derived metadata changed", () => {
    const oldProfile = baseProfile(["duplicate", "duplicate", "outside"]);
    oldProfile.preferences[1]!.centroid = [0.1, 0.2];
    const currentProfile = structuredClone(oldProfile);
    currentProfile.preferences[1]!.centroid = undefined;

    const { profile } = applyCleanupEdits(
      currentProfile,
      jobFor(oldProfile, { merged: [{ ids: ["pref_0", "pref_1"], result: "duplicate" }] }),
      { merged: [["pref_0", "pref_1"]], removed: [] }
    );

    expect(profile.preferences.map((p) => p.description)).toEqual(["duplicate", "outside"]);
  });
});

describe("rebuildProfileUsing (#237)", () => {
  it("does not preserve merge sources as unmentioned items", () => {
    const target = { id: "pref_0", ...pref("duplicate"), frequency: 2, lastSeen: 1 };
    const source = { id: "pref_1", ...pref("duplicate"), frequency: 3, lastSeen: 1 };
    const cleanedTarget = { id: "pref_0", ...pref("duplicate"), frequency: 5, lastSeen: 1 };

    const result = rebuildProfileUsing(
      { kept: [], merged: [["pref_0", "pref_1"]], removed: [] },
      new Map([["pref_0", cleanedTarget]]),
      new Map([
        ["pref_0", target],
        ["pref_1", source],
      ])
    );

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]?.description).toBe("duplicate");
  });
});
