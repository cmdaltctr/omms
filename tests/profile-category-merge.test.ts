import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddingService } from "../src/services/embedding.js";
import { tursoConnectionManager } from "../src/services/turso/connection-manager.js";

let tmpDir: string;

async function makeManager() {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = tmpDir;
  CONFIG.userProfileEmbeddingMinDescriptionLength = 5;
  CONFIG.userProfileEmbeddingThresholdSameCat = 0.8;
  CONFIG.userProfileEmbeddingThresholdSameCatWeak = 0.5;
  CONFIG.userProfileEmbeddingThresholdCrossCat = 0.9;
  CONFIG.userProfileEmbeddingThresholdCrossCatWeak = 0.8;
  const { UserProfileManager } =
    await import("../src/services/user-profile/user-profile-manager.js");
  return new UserProfileManager();
}

/** Unit vector padded to the same dimensions as the workflow regression tests. */
function vec(...components: number[]): number[] {
  const vector = new Array<number>(10).fill(0);
  components.forEach((value, index) => (vector[index] = value));
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

/** Fixed vectors avoid a real embedding model and give exact similarity scores. */
function embedFor(vectors: Record<string, number[]>) {
  return {
    isWarmedUp: true,
    embed: async (text: string) => {
      const vector = vectors[text.trim()];
      if (!vector) throw new Error("Missing test embedding");
      return new Float32Array(vector);
    },
  } as unknown as EmbeddingService;
}

function storedPreference(category: string, centroid: number[]) {
  return {
    category,
    description: "Stored preference for tests",
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
  };
}

describe("category merging", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omms-category-merge-"));
  });

  afterEach(async () => {
    await tursoConnectionManager.closeAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges spelling variants in the same-category strong band", async () => {
    const manager = await makeManager();
    const base = vec(1);
    const description = "New communication preference for tests";
    const merged = await manager.mergeProfileData(
      { preferences: [storedPreference("communication_style", base)], patterns: [], workflows: [] },
      { preferences: [{ ...storedPreference("Communication style", base), description }] },
      embedFor({ [description]: vec(0.85, Math.sqrt(1 - 0.85 ** 2)) })
    );
    expect(merged.preferences).toHaveLength(1);
    // Cross-category weak matches never increment frequency, even if the random draw upgrades them.
    expect(merged.preferences[0]!.frequency).toBe(2);
    expect(merged.preferences[0]!.alpha).toBe(3);
  });

  it("keeps different categories below the cross-category weak threshold separate", async () => {
    const manager = await makeManager();
    const base = vec(1);
    const description = "New testing preference for tests";
    const merged = await manager.mergeProfileData(
      { preferences: [storedPreference("tooling", base)], patterns: [], workflows: [] },
      { preferences: [{ ...storedPreference("testing", base), description }] },
      embedFor({ [description]: vec(0.75, Math.sqrt(1 - 0.75 ** 2)) })
    );
    expect(merged.preferences).toHaveLength(2);
    expect(merged.preferences[0]!.frequency).toBe(1);
    expect(merged.preferences[1]!.category).toBe("testing");
  });
});
