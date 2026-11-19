import { cosineSimilarityNumbers, l2Normalize } from "../../utils/math.js";
import { log } from "../logger.js";
import {
  isMilestone,
  minEvidenceForEvolve,
  ensureArray,
  sampleBeta,
  syncConfidence,
} from "./profile-confidence.js";
import { initItem, mergeConfirmedMatch } from "./profile-merge-items.js";
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
 * Weak embedding matches: the same-category forced merge and the Thompson-sampled
 * upgrade. Returns null when the best match is not weak.
 */
export async function matchWeak<T extends MergeableItem>(
  host: ProfileHost,
  run: MergeRun,
  existing: T[],
  newItem: T,
  newEmb: Float32Array,
  rank: CandidateRank
): Promise<MergeOutcome | null> {
  const config = host.config;
  const { itemType, profileId, driftThreshold } = run;
  const { top1Score, top1Idx, top1SameCat, top1Band } = rank;
  let matched = 0;
  let added = 0;

  if (top1Idx >= 0 && top1Band === "weak") {
    const existingItem = existing[top1Idx]!;

    if (top1SameCat) {
      const existingDriftBelow = ((existingItem as any).driftBelowCount as number) || 0;
      const centroid = (existingItem as any).centroid as number[];
      const anchor = (existingItem as any).anchor as number[];
      const newEmbArr = Array.from(newEmb);
      const updatedCentroid = l2Normalize(
        centroid.map(
          (v, i) => CENTROID_EMA_WEIGHT * v + CENTROID_EMA_WEIGHT_COMPLEMENT * (newEmbArr[i] ?? 0)
        )
      );

      let driftBelowCount = existingDriftBelow;
      if (anchor && anchor.length === updatedCentroid.length) {
        const driftScore = cosineSimilarityNumbers(updatedCentroid, anchor);
        if (driftScore < driftThreshold) {
          driftBelowCount = existingDriftBelow + 1;
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
        log("profile drift fuse: forced merge path, frozen existing", {
          type: itemType,
          idx: top1Idx,
          driftBelowCount,
          driftScore: anchor
            ? Math.round(cosineSimilarityNumbers(updatedCentroid, anchor) * 100) / 100
            : null,
        });
        return { matched, added };
      }

      const combined = { ...existingItem };
      (combined as any).alpha = ((existingItem as any).alpha || 1) + top1Score * 1.0;
      (combined as any).frequency = ((existingItem as any).frequency || 1) + 1;
      (combined as any).evidence = [
        ...new Set([
          (newItem as any).description || newItem.description,
          ...ensureArray((newItem as any).evidence),
          ...ensureArray((existingItem as any as any).evidence),
        ]),
      ].slice(0, 10);
      (combined as any).weakAlpha = 1;
      (combined as any).weakBeta = 1;
      (combined as any).weakHitCount = 0;
      (combined as any).lastWeakHitAt = null;
      (combined as any).lastMatchTime = Date.now();
      (combined as any).centroid = updatedCentroid;
      (combined as any).anchor = anchor;
      (combined as any).driftBelowCount = driftBelowCount;
      syncConfidence(combined as any, config);

      existing[top1Idx] = combined;
      matched++;

      const driftInfo =
        anchor && anchor.length === updatedCentroid.length
          ? {
              driftScore: Math.round(cosineSimilarityNumbers(updatedCentroid, anchor) * 100) / 100,
              driftBelowCount,
            }
          : {};

      log("profile matched: same-cat forced merge", {
        type: itemType,
        idx: top1Idx,
        cat: existingItem.category,
        score: Math.round(top1Score * 100) / 100,
        confidence: `${Math.round(((existingItem as any).confidence || 0) * 100) / 100}→${Math.round((combined as any).confidence * 100) / 100}`,
        frequency: `${(existingItem as any).frequency || 1}→${(combined as any).frequency || "?"}`,
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

    const weakAlpha = ((existingItem as any).weakAlpha || 1) + top1Score;
    const weakBeta = ((existingItem as any).weakBeta || 1) + (1 - top1Score);
    const effectiveAlpha = weakAlpha;
    const effectiveBeta = weakBeta;
    const upgraded =
      effectiveAlpha + effectiveBeta > 7
        ? effectiveAlpha / (effectiveAlpha + effectiveBeta) >= 0.45
        : sampleBeta(effectiveAlpha, effectiveBeta) >= 0.5;
    if (upgraded) {
      const oldFreq = (existingItem as any).frequency || 1;
      const centroid = (existingItem as any).centroid as number[];
      const anchor = (existingItem as any).anchor as number[];
      const newEmbArr = Array.from(newEmb);
      const updatedCentroid = l2Normalize(
        centroid.map(
          (v, i) => CENTROID_EMA_WEIGHT * v + CENTROID_EMA_WEIGHT_COMPLEMENT * (newEmbArr[i] ?? 0)
        )
      );

      const combined = mergeConfirmedMatch(existingItem, newItem, itemType, false, config) as T;
      (combined as any).centroid = updatedCentroid;
      (combined as any).anchor = anchor;
      (combined as any).alpha += 0.5;
      (combined as any).weakAlpha = 1;
      (combined as any).weakBeta = 1;
      (combined as any).driftBelowCount = (existingItem as any).driftBelowCount || 0;
      syncConfidence(combined as any, config);

      existing[top1Idx] = combined;
      matched++;
      log("profile matched: weak upgrade (thompson)", {
        type: itemType,
        idx: top1Idx,
        cat: existingItem.category,
        score: Math.round(top1Score * 100) / 100,
        weakAlpha: Math.round(weakAlpha * 100) / 100,
        weakBeta: Math.round(weakBeta * 100) / 100,
        forced: effectiveAlpha + effectiveBeta > 7,
        frequency: `${oldFreq}→${(combined as any).frequency || "?"}`,
        incomingDesc: (newItem.description || "").substring(0, 40),
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
    if (effectiveAlpha + effectiveBeta <= 7) {
      (existingItem as any).weakAlpha = effectiveAlpha;
      (existingItem as any).weakBeta = effectiveBeta;
    } else {
      (existingItem as any).weakAlpha = 1;
      (existingItem as any).weakBeta = 1;
    }
    (existingItem as any).lastSeen = Date.now();
    (existingItem as any).lastWeakHitAt = Date.now();
    log("profile weak hit (thompson)", {
      type: itemType,
      idx: top1Idx,
      cat: existingItem.category,
      score: Math.round(top1Score * 100) / 100,
      weakAlpha: Math.round(weakAlpha * 100) / 100,
      weakBeta: Math.round(weakBeta * 100) / 100,
      forcedReset: effectiveAlpha + effectiveBeta > 7,
      incomingDesc: (newItem.description || "").substring(0, 40),
    });
    return { matched, added };
  }

  return null;
}
