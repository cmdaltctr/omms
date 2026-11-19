import { cosineSimilarityNumbers, l2Normalize } from "../../utils/math.js";
import { log } from "../logger.js";
import { categoryKey } from "./profile-category.js";
import {
  isMilestone,
  lazyMigrateAlpha,
  minEvidenceForEvolve,
  ensureArray,
  syncConfidence,
} from "./profile-confidence.js";
import { combineThree, initItem, mergeConfirmedMatch } from "./profile-merge-items.js";
import type {
  CandidateRank,
  MergeableItem,
  MergeOutcome,
  MergeRun,
  ProfileHost,
} from "./profile-host.js";

const CENTROID_EMA_WEIGHT = 0.85;
const CENTROID_EMA_WEIGHT_COMPLEMENT = 0.15;

/**
 * Strong embedding matches: the three-way merge and the single strong merge.
 * Returns null when neither applies.
 */
export async function matchStrong<T extends MergeableItem>(
  host: ProfileHost,
  run: MergeRun,
  existing: T[],
  newItem: T,
  newEmb: Float32Array,
  rank: CandidateRank
): Promise<MergeOutcome | null> {
  const config = host.config;
  const { itemType, isWorkflow, profileId, sameCatStrong, driftThreshold } = run;
  const { top1Score, top1Idx, top1SameCat, top1Band, top2Score, top2Idx, top2SameCat, top2Band } =
    rank;
  let matched = 0;
  let added = 0;

  if (
    top1Idx >= 0 &&
    top1Band === "strong" &&
    top2Idx >= 0 &&
    top2Band === "strong" &&
    top1SameCat &&
    top2SameCat &&
    !isWorkflow
  ) {
    const item1 = existing[top1Idx]!;
    const item2 = existing[top2Idx]!;
    const newEmbArr = Array.from(newEmb);
    const threeWayResult = combineThree(
      item1,
      item2,
      newItem,
      itemType,
      newEmbArr,
      top1Score,
      config
    );
    existing[top1Idx] = threeWayResult as T;
    const removeIdx = top2Idx;
    existing.splice(removeIdx, 1);
    matched += 2;
    log("profile matched: three-way merge", {
      type: itemType,
      idx1: top1Idx,
      idx2: removeIdx,
      cat: item1.category,
      score1: Math.round(top1Score * 100) / 100,
      score2: Math.round(top2Score * 100) / 100,
      freq1: (item1 as any).frequency,
      freq2: (item2 as any).frequency,
      combinedFreq: (threeWayResult as any).frequency,
    });
    if (
      isMilestone((threeWayResult as any).frequency || 1) &&
      (threeWayResult as any).evidence?.length >= minEvidenceForEvolve(itemType)
    ) {
      await host.evolveAndUpdate(threeWayResult as any, itemType, profileId);
    }
    return { matched, added };
  }

  if (top1Idx >= 0 && top1Band === "strong") {
    const existingItem = existing[top1Idx]!;
    const oldFreq = (existingItem as any).frequency || 1;
    const centroid = (existingItem as any).centroid as number[];
    const anchor = (existingItem as any).anchor as number[];

    const newEmbArr = Array.from(newEmb);
    const updatedCentroid = l2Normalize(
      centroid.map(
        (v, i) => CENTROID_EMA_WEIGHT * v + CENTROID_EMA_WEIGHT_COMPLEMENT * (newEmbArr[i] ?? 0)
      )
    );

    let driftBelowCount = ((existingItem as any).driftBelowCount as number) || 0;
    if (anchor && anchor.length === updatedCentroid.length) {
      const driftScore = cosineSimilarityNumbers(updatedCentroid, anchor);
      if (driftScore < driftThreshold) {
        driftBelowCount++;
      } else {
        driftBelowCount = 0;
      }
    }

    if (driftBelowCount >= 2) {
      const driftCentroid = Array.from(newEmb);
      const driftAnchor = driftCentroid;
      const frozenItem = { ...existingItem };
      (frozenItem as any).centroid = centroid;
      (frozenItem as any).driftBelowCount = driftBelowCount;
      existing[top1Idx] = frozenItem as T;
      existing.push(initItem(newItem, itemType, driftCentroid, driftAnchor, config) as T);
      added++;
      log("profile drift fuse: frozen existing, new item created", {
        type: itemType,
        idx: top1Idx,
        driftBelowCount,
        driftScore: anchor
          ? Math.round(cosineSimilarityNumbers(updatedCentroid, anchor) * 100) / 100
          : null,
      });
      return { matched, added };
    }

    const combined = mergeConfirmedMatch(existingItem, newItem, itemType, top1SameCat, config) as T;
    (combined as any).centroid = updatedCentroid;
    (combined as any).anchor = anchor;
    (combined as any).driftBelowCount = driftBelowCount;
    (combined as any).weakHitCount = 0;
    (combined as any).lastWeakHitAt = null;

    if (
      top1Score > 0.9 &&
      top1SameCat &&
      newItem.description.length < (existingItem as any).description?.length
    ) {
      (combined as any).description = newItem.description;
    }

    existing[top1Idx] = combined;
    matched++;

    if (top1SameCat && !isWorkflow) {
      const mergeIndices: number[] = [];
      for (let j = 0; j < existing.length; j++) {
        if (j === top1Idx) continue;
        const other = existing[j];
        if (
          !other ||
          categoryKey(other.category ?? "") !== categoryKey(existingItem.category ?? "")
        )
          continue;
        const otherCentroid = (other as any).centroid as number[] | undefined;
        if (!otherCentroid) continue;
        const crossScore = cosineSimilarityNumbers(Array.from(newEmb), otherCentroid);
        if (crossScore >= sameCatStrong) {
          mergeIndices.push(j);
          lazyMigrateAlpha(combined as any, config);
          lazyMigrateAlpha(other as any, config);
          (combined as any).alpha += (other as any).alpha || 1;
          (combined as any).beta = ((combined as any).beta || 1) + ((other as any).beta || 1);
          const oldFreq = (combined as any).frequency || 1;
          (combined as any).frequency += (other as any).frequency || 1;
          (combined as any).evidence = [
            ...new Set([
              ...ensureArray((combined as any).evidence),
              ...ensureArray((other as any).evidence),
            ]),
          ].slice(0, 10);
          const combinedCentroid = (combined as any).centroid as number[];
          const w1 = oldFreq / (oldFreq + ((other as any).frequency || 1));
          const w2 = ((other as any).frequency || 1) / (oldFreq + ((other as any).frequency || 1));
          const mergedCentroid = l2Normalize(
            combinedCentroid.map((v, i) => w1 * v + w2 * (otherCentroid[i] ?? 0))
          );
          (combined as any).centroid = mergedCentroid;
          syncConfidence(combined as any, config);
          matched++;
          log("profile matched: cross-validation merge", {
            type: itemType,
            idx: top1Idx,
            mergedIdx: j,
            cat: other.category,
            crossScore: Math.round(crossScore * 100) / 100,
            mergedAlpha: Math.round((combined as any).alpha),
            combinedFreq: (combined as any).frequency,
          });
        }
      }
      for (let i = mergeIndices.length - 1; i >= 0; i--) {
        existing.splice(mergeIndices[i]!, 1);
      }
    }

    const driftInfo =
      anchor && anchor.length === updatedCentroid.length
        ? {
            driftScore: Math.round(cosineSimilarityNumbers(updatedCentroid, anchor) * 100) / 100,
            driftBelowCount,
          }
        : {};

    log("profile matched: embedding strong", {
      type: itemType,
      idx: top1Idx,
      cat: existingItem.category,
      score: Math.round(top1Score * 100) / 100,
      sameCat: top1SameCat,
      frequency: `${oldFreq}→${(combined as any).frequency || "?"}`,
      ...driftInfo,
    });

    const newFreq = (combined as any).frequency || 1;
    if (
      isMilestone(newFreq) &&
      (combined as any).evidence?.length >= minEvidenceForEvolve(itemType)
    ) {
      await host.evolveAndUpdate(combined as any, itemType, profileId);
    }

    return { matched, added };
  }

  return null;
}
