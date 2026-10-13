import { cosineSimilarityNumbers } from "../../utils/math.js";
import { categoryKey } from "./profile-category.js";

/** Rank embedding matches without changing profile items or applying merge actions. */
export function rankProfileCandidates(
  existing: readonly { category?: string; centroid?: number[] }[],
  category: string | undefined,
  embedding: number[],
  isWorkflow: boolean,
  config: {
    userProfileEmbeddingThresholdSameCat: number;
    userProfileEmbeddingThresholdSameCatWeak: number;
    userProfileEmbeddingThresholdCrossCat: number;
    userProfileEmbeddingThresholdCrossCatWeak: number;
  }
) {
  let top1Score = 0;
  let top1Idx = -1;
  let top1SameCat = false;
  let top1Band: "strong" | "weak" | null = null;
  let top2Score = 0;
  let top2Idx = -1;
  let top2SameCat = false;
  let top2Band: "strong" | "weak" | null = null;

  for (let i = 0; i < existing.length; i++) {
    const existingItem = existing[i];
    if (!existingItem) continue;

    const centroid = existingItem.centroid;
    if (!centroid) continue;

    const score = cosineSimilarityNumbers(embedding, centroid);
    const sameCat = isWorkflow
      ? existingItem.category === category
      : categoryKey(existingItem.category ?? "") === categoryKey(category ?? "");
    const strongThreshold = sameCat
      ? config.userProfileEmbeddingThresholdSameCat
      : config.userProfileEmbeddingThresholdCrossCat;
    const weakThreshold = sameCat
      ? config.userProfileEmbeddingThresholdSameCatWeak
      : config.userProfileEmbeddingThresholdCrossCatWeak;

    let band: "strong" | "weak";
    if (score >= strongThreshold) {
      band = "strong";
    } else if (score >= weakThreshold && !isWorkflow) {
      band = "weak";
    } else {
      continue;
    }

    if (score > top1Score) {
      top2Score = top1Score;
      top2Idx = top1Idx;
      top2SameCat = top1SameCat;
      top2Band = top1Band;
      top1Score = score;
      top1Idx = i;
      top1SameCat = sameCat;
      top1Band = band;
    } else if (score > top2Score) {
      top2Score = score;
      top2Idx = i;
      top2SameCat = sameCat;
      top2Band = band;
    }
  }

  return {
    top1Score,
    top1Idx,
    top1SameCat,
    top1Band,
    top2Score,
    top2Idx,
    top2SameCat,
    top2Band,
  };
}
