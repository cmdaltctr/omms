import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

// Characterisation tests for the merge branches of UserProfileManager.mergeProfileData.
// They pin today's results so the module split cannot change them.

let tmpDir: string;

async function makeManager() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = tmpDir;
  CONFIG.userProfileEmbeddingMinDescriptionLength = 5;
  CONFIG.userProfileEmbeddingThresholdSameCat = 0.8;
  CONFIG.userProfileEmbeddingThresholdSameCatWeak = 0.5;
  CONFIG.userProfileEmbeddingThresholdCrossCat = 0.9;
  CONFIG.userProfileEmbeddingThresholdCrossCatWeak = 0.8;
  CONFIG.userProfileCentroidDriftThreshold = 0.65;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

const DIMS = 8;

/** Unit vector from a few leading components, padded with zeros. */
function vec(...components: number[]): number[] {
  const v = new Array(DIMS).fill(0);
  components.forEach((c, i) => (v[i] = c));
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / norm);
}

/** Embedding stub: each description maps to a fixed vector, so similarity is exact. */
function embedFor(vectors: Record<string, number[]>) {
  return {
    isWarmedUp: true,
    embed: async (text: string) => {
      const v = vectors[text.trim()];
      if (!v) throw new Error(`no test vector for "${text}"`);
      return new Float32Array(v);
    },
  } as any;
}

function stored(category: string, description: string, centroid: number[], extra = {}) {
  return {
    category,
    description,
    alpha: 2,
    beta: 1,
    weakAlpha: 1,
    weakBeta: 1,
    confidence: 0.6,
    frequency: 1,
    lastSeen: Date.now(),
    lastMatchTime: Date.now(),
    firstSeen: Date.now(),
    evidence: [] as string[],
    weakHitCount: 0,
    driftBelowCount: 0,
    pendingValidation: false,
    centroid,
    anchor: centroid,
    ...extra,
  };
}

const profile = (preferences: any[]) => ({ preferences, patterns: [], workflows: [] });

function expectVector(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5));
}

function emaCentroid(centroid: number[], incoming: number[]): number[] {
  const mixed = centroid.map((v, i) => 0.85 * v + 0.15 * incoming[i]!);
  const norm = Math.sqrt(mixed.reduce((a, b) => a + b * b, 0));
  return mixed.map((v) => v / norm);
}

describe("user profile manager merge", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-upm-merge-"));
  });

  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    await new Promise((r) => setTimeout(r, 50));
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore leftover test files
    }
  });

  it("folds an exact match into the stored item", async () => {
    const mgr = await makeManager();
    const existing = stored("Style", "Prefers tabs for indentation", vec(1));
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      {
        preferences: [
          { category: "style", description: "Prefers tabs for indentation", evidence: ["e1"] },
        ] as any,
      },
      embedFor({})
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.frequency).toBe(2);
    expect(item.alpha).toBe(3);
    expect(item.beta).toBe(1);
    expect(item.evidence).toEqual(["Prefers tabs for indentation", "e1"]);
    expect(item.category).toBe("Style");
  });

  it("combines two strong same-category matches into one item", async () => {
    const mgr = await makeManager();
    const first = stored("Style", "Uses tabs everywhere in code", vec(1, 0.1));
    const second = stored("Style", "Indents code with tab characters", vec(1, 0.2));
    const incoming = "Tabs are the indentation the user picks every time";
    const merged = await mgr.mergeProfileData(
      profile([first, second]),
      { preferences: [{ category: "Style", description: incoming }] as any },
      embedFor({ [incoming]: vec(1, 0.15) })
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.frequency).toBe(3);
    expect(item.alpha).toBe(5);
    expect(item.beta).toBe(2);
    expect(item.driftBelowCount).toBe(0);
    expect(item.description).toBe("Indents code with tab characters");
    const mixed = vec(1, 0.2).map(
      (v, i) => 0.45 * v + 0.45 * vec(1, 0.1)[i]! + 0.1 * vec(1, 0.15)[i]!
    );
    const norm = Math.sqrt(mixed.reduce((a, b) => a + b * b, 0));
    expectVector(
      item.centroid,
      mixed.map((v) => v / norm)
    );
  });

  it("moves the centroid on a strong single match and keeps the anchor", async () => {
    const mgr = await makeManager();
    const existing = stored("Style", "Prefers tabs for indentation", vec(1, 0.1));
    const incoming = "Picks tab characters for indenting source files";
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Style", description: incoming }] as any },
      embedFor({ [incoming]: vec(1, 0.3) })
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.frequency).toBe(2);
    expect(item.alpha).toBe(3);
    expect(item.weakHitCount).toBe(0);
    expect(item.lastWeakHitAt).toBeNull();
    expect(item.driftBelowCount).toBe(0);
    expect(item.description).toBe("Prefers tabs for indentation");
    expectVector(item.anchor, vec(1, 0.1));
    expectVector(item.centroid, emaCentroid(vec(1, 0.1), vec(1, 0.3)));
  });

  it("freezes the stored item and appends a new one after a second drift", async () => {
    const mgr = await makeManager();
    const existing = stored("Style", "Prefers tabs for indentation", vec(1), {
      anchor: vec(0, 1),
      driftBelowCount: 1,
    });
    const incoming = "Picks tab characters for indenting source files";
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Style", description: incoming }] as any },
      embedFor({ [incoming]: vec(1, 0.05) })
    );

    expect(merged.preferences).toHaveLength(2);
    const frozen = merged.preferences[0] as any;
    const added = merged.preferences[1] as any;
    expect(frozen.description).toBe("Prefers tabs for indentation");
    expect(frozen.frequency).toBe(1);
    expect(frozen.driftBelowCount).toBe(2);
    expectVector(frozen.centroid, vec(1));
    expect(added.description).toBe(incoming);
    expect(added.frequency).toBe(1);
    expect(added.pendingValidation).toBe(true);
    expectVector(added.centroid, vec(1, 0.05));
    expectVector(added.anchor, vec(1, 0.05));
  });

  it("forces a merge on a weak same-category match", async () => {
    const mgr = await makeManager();
    const existing = stored("Style", "Prefers tabs for indentation", vec(1));
    const incoming = "Sometimes aligns code with spaces";
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Style", description: incoming, evidence: ["e2"] }] as any },
      embedFor({ [incoming]: vec(0.6, 0.8) })
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.frequency).toBe(2);
    expect(item.alpha).toBeCloseTo(2.6, 5);
    expect(item.weakAlpha).toBe(1);
    expect(item.weakBeta).toBe(1);
    expect(item.driftBelowCount).toBe(0);
    expect(item.evidence).toEqual([incoming, "e2"]);
    expectVector(item.anchor, vec(1));
    expectVector(item.centroid, emaCentroid(vec(1), vec(0.6, 0.8)));
  });

  it("upgrades a weak cross-category hit once the weak counts pass seven", async () => {
    const mgr = await makeManager();
    const existing = stored("Editor", "Prefers tabs for indentation", vec(1), {
      weakAlpha: 4,
      weakBeta: 3,
    });
    const incoming = "Uses a dark editor theme at night";
    const emb = vec(0.85, Math.sqrt(1 - 0.85 * 0.85));
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Style", description: incoming }] as any },
      embedFor({ [incoming]: emb })
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.category).toBe("Editor");
    expect(item.frequency).toBe(1);
    expect(item.alpha).toBeCloseTo(3, 5);
    expect(item.weakAlpha).toBe(1);
    expect(item.weakBeta).toBe(1);
    expect(item.evidence).toEqual([incoming]);
    expectVector(item.centroid, emaCentroid(vec(1), emb));
  });

  it("resets the weak counts without a merge when the upgrade ratio is too low", async () => {
    const mgr = await makeManager();
    const existing = stored("Editor", "Prefers tabs for indentation", vec(1), {
      weakAlpha: 1,
      weakBeta: 6,
    });
    const incoming = "Uses a dark editor theme at night";
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Style", description: incoming }] as any },
      embedFor({ [incoming]: vec(0.85, Math.sqrt(1 - 0.85 * 0.85)) })
    );

    expect(merged.preferences).toHaveLength(1);
    const item = merged.preferences[0] as any;
    expect(item.alpha).toBe(2);
    expect(item.frequency).toBe(1);
    expect(item.weakAlpha).toBe(1);
    expect(item.weakBeta).toBe(1);
    expect(typeof item.lastWeakHitAt).toBe("number");
    expect(item.evidence).toEqual([]);
  });

  it("appends an unmatched item with starting counts and its embedding", async () => {
    const mgr = await makeManager();
    const existing = stored("Style", "Prefers tabs for indentation", vec(1));
    const incoming = "Writes commit messages in British English";
    const merged = await mgr.mergeProfileData(
      profile([existing]),
      { preferences: [{ category: "Language", description: incoming }] as any },
      embedFor({ [incoming]: vec(0, 1) })
    );

    expect(merged.preferences).toHaveLength(2);
    const added = merged.preferences[1] as any;
    expect(added.description).toBe(incoming);
    expect(added.alpha).toBe(0.3);
    expect(added.beta).toBe(1.5);
    expect(added.frequency).toBe(1);
    expect(added.pendingValidation).toBe(true);
    expect(added.evidence).toEqual([]);
    expectVector(added.centroid, vec(0, 1));
    expectVector(added.anchor, vec(0, 1));
  });
});
