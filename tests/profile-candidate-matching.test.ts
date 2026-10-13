import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddingService } from "../src/services/embedding.js";
import type { UserProfileManager } from "../src/services/user-profile/user-profile-manager.js";
import { rankProfileCandidates } from "../src/services/user-profile/profile-candidate-matching.js";

const config = {
  userProfileEmbeddingThresholdSameCat: 0.8,
  userProfileEmbeddingThresholdSameCatWeak: 0.5,
  userProfileEmbeddingThresholdCrossCat: 0.9,
  userProfileEmbeddingThresholdCrossCatWeak: 0.8,
};

function candidate(score: number, category?: string) {
  return { category, centroid: [score, Math.sqrt(1 - score ** 2)] };
}

describe("profile candidate ranking", () => {
  it("ranks the two highest scores and keeps the first candidate on a tie", () => {
    const ranked = rankProfileCandidates(
      [candidate(0.85, "style"), candidate(0.95, "style"), candidate(0.95, "style")],
      "style",
      [1, 0],
      false,
      config
    );
    expect(ranked.top1Idx).toBe(1);
    expect(ranked.top2Idx).toBe(2);
    expect(ranked.top1Score).toBeCloseTo(0.95);
    expect(ranked.top2Score).toBeCloseTo(0.95);
    expect(ranked.top1SameCat).toBe(true);
    expect(ranked.top2SameCat).toBe(true);
    expect(ranked.top1Band).toBe("strong");
    expect(ranked.top2Band).toBe("strong");
  });

  it("uses separate same-category and cross-category weak thresholds", () => {
    const ranked = rankProfileCandidates(
      [candidate(0.75, "tooling"), candidate(0.7, "testing")],
      "testing",
      [1, 0],
      false,
      config
    );
    expect(ranked.top1Idx).toBe(1);
    expect(ranked.top1Band).toBe("weak");
    expect(ranked.top1SameCat).toBe(true);
    expect(ranked.top2Idx).toBe(-1);
  });

  it("classifies cross-category strong and weak candidates", () => {
    const ranked = rankProfileCandidates(
      [candidate(0.85, "tooling"), candidate(0.95, "tooling")],
      "testing",
      [1, 0],
      false,
      config
    );
    expect(ranked.top1Idx).toBe(1);
    expect(ranked.top1Band).toBe("strong");
    expect(ranked.top1SameCat).toBe(false);
    expect(ranked.top2Idx).toBe(0);
    expect(ranked.top2Band).toBe("weak");
    expect(ranked.top2SameCat).toBe(false);
  });

  it("keeps category-free workflows in the same-category strong band only", () => {
    const ranked = rankProfileCandidates(
      [candidate(0.7), candidate(0.85)],
      undefined,
      [1, 0],
      true,
      config
    );
    expect(ranked.top1Idx).toBe(1);
    expect(ranked.top1Band).toBe("strong");
    expect(ranked.top1SameCat).toBe(true);
    expect(ranked.top2Idx).toBe(-1);
  });

  it("skips missing centroids and incompatible dimensions", () => {
    const ranked = rankProfileCandidates(
      [{ category: "style" }, { category: "style", centroid: [1] }],
      "style",
      [1, 0],
      false,
      config
    );
    expect(ranked.top1Idx).toBe(-1);
    expect(ranked.top2Idx).toBe(-1);
    expect(ranked.top1Score).toBe(0);
    expect(ranked.top1Band).toBeNull();
    expect(ranked.top2Band).toBeNull();
  });

  it("uses the same-category strong threshold for spelling variants", () => {
    const ranked = rankProfileCandidates(
      [candidate(0.85, "communication_style")],
      " Communication-Style ",
      [1, 0],
      false,
      config
    );
    expect(ranked.top1Idx).toBe(0);
    expect(ranked.top1Band).toBe("strong");
    expect(ranked.top1SameCat).toBe(true);
  });

  it("uses the supplied config thresholds", () => {
    const ranked = rankProfileCandidates([candidate(0.95, "style")], "style", [1, 0], false, {
      ...config,
      userProfileEmbeddingThresholdSameCat: 0.99,
    });
    expect(ranked.top1Idx).toBe(0);
    expect(ranked.top1Band).toBe("weak");
  });
});

function storedItem(category: string, description: string, score = 1, frequency = 1) {
  const { centroid } = candidate(score);
  return { category, description, centroid, anchor: centroid, frequency, alpha: 2, beta: 1 };
}

describe("category keys in candidate matching", () => {
  let directory: string;
  let manager: UserProfileManager;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "omms-candidate-matching-"));
    const { CONFIG } = await import("../src/config.js");
    Object.assign(CONFIG, config, {
      storagePath: directory,
      userProfileEmbeddingMinDescriptionLength: 5,
    });
    const { UserProfileManager } =
      await import("../src/services/user-profile/user-profile-manager.js");
    manager = new UserProfileManager();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("matches an identical pattern description by category key without embeddings", async () => {
    const description = "Stored communication pattern for tests";
    const merged = await manager.mergeProfileData(
      {
        preferences: [],
        patterns: [storedItem("communication_style", description)],
        workflows: [],
      },
      { patterns: [{ category: "Communication style", description }] },
      { isWarmedUp: false } as EmbeddingService
    );
    expect(merged.patterns).toHaveLength(1);
    expect(merged.patterns[0]!.frequency).toBe(2);
    expect(merged.patterns[0]!.category).toBe("communication_style");
  });

  it("folds a spelling-variant neighbour while leaving a cross-category candidate alone", async () => {
    const description = "Incoming communication preference for tests";
    // The cross-category runner-up keeps this on the neighbour-fold path, rather than three-way.
    const merged = await manager.mergeProfileData(
      {
        preferences: [
          storedItem("Communication style", "Primary communication preference", 0.98),
          storedItem("tooling", "Unrelated tooling preference", 0.96),
          storedItem("communication_style", "Neighbour communication preference", 0.85, 4),
        ],
        patterns: [],
        workflows: [],
      },
      { preferences: [{ category: "Communication style", description }] },
      {
        isWarmedUp: true,
        embed: async () => new Float32Array([1, 0]),
      } as unknown as EmbeddingService
    );
    expect(merged.preferences).toHaveLength(2);
    expect(merged.preferences[0]!.category).toBe("Communication style");
    expect(merged.preferences[0]!.frequency).toBe(6);
    expect(merged.preferences[1]!.category).toBe("tooling");
    expect(merged.preferences[1]!.frequency).toBe(1);
  });
});
