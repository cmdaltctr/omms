import { l2Normalize } from "../../utils/math.js";
import type { ConfidenceConfig } from "./profile-confidence.js";
import { ensureArray, lazyMigrateAlpha, syncConfidence } from "./profile-confidence.js";

const THREE_WAY_CENTROID_W1 = 0.45;
const THREE_WAY_CENTROID_W2 = 0.45;
const THREE_WAY_CENTROID_W3 = 0.1;

/**
 * Merge a new confirmed observation into an existing profile entry.
 * ONLY call for confirmed matches (exact, strong sameCat/crossCat, Thompson upgrade).
 * Do NOT call for forced merge or cross-validation — those handle fields directly.
 */
export function mergeConfirmedMatch(
  existing: any,
  newItem: any,
  itemType: string,
  sameCat: boolean,
  config: ConfidenceConfig
): any {
  lazyMigrateAlpha(existing, config);
  const evidence = [
    ...new Set([
      newItem.description,
      ...ensureArray(newItem.evidence),
      ...ensureArray(existing.evidence),
    ]),
  ].slice(0, 10);

  if (sameCat) {
    const result = {
      ...existing,
      alpha: existing.alpha + 1,
      beta: existing.beta ?? 1,
      weakAlpha: 1,
      weakBeta: 1,
      frequency: (existing.frequency || 1) + 1,
      evidence,
      lastSeen: Date.now(),
      lastMatchTime: Date.now(),
      ...(itemType === "workflow" ? longerSteps(existing, newItem) : {}),
    };
    syncConfidence(result, config);
    return result;
  }

  const result = {
    ...existing,
    alpha: existing.alpha + 0.5,
    beta: existing.beta ?? 1,
    weakAlpha: 1,
    weakBeta: 1,
    evidence,
    lastSeen: Date.now(),
    lastMatchTime: Date.now(),
    ...(itemType === "workflow" ? longerSteps(existing, newItem) : {}),
  };
  syncConfidence(result, config);
  return result;
}

/**
 * A match keeps the fullest known step list: the new steps win only when they hold more
 * concrete (non-blank) steps. Blank entries never count, and a winning list drops them.
 */
function longerSteps(existing: any, newItem: any): { steps?: string[] } {
  const concrete = (steps: unknown): string[] =>
    Array.isArray(steps)
      ? steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
      : [];
  const known = concrete(existing.steps).length;
  const incoming = concrete(newItem.steps);
  return incoming.length > known ? { steps: incoming } : {};
}

export function initItem(
  newItem: any,
  itemType: string,
  centroid: number[] | undefined,
  anchor: number[] | undefined,
  config: ConfidenceConfig
): any {
  const hasEvidence = Array.isArray(newItem.evidence) && newItem.evidence.length > 0;
  const item = {
    ...newItem,
    alpha: hasEvidence ? 1 : 0.3,
    beta: hasEvidence ? 1 : 1.5,
    weakAlpha: 1,
    weakBeta: 1,
    confidence: hasEvidence ? (newItem.confidence ?? 0.5) : 0.2,
    frequency: 1,
    lastSeen: Date.now(),
    lastMatchTime: Date.now(),
    firstSeen: Date.now(),
    evidence: newItem.evidence ?? [],
    weakHitCount: 0,
    driftBelowCount: 0,
    pendingValidation: true,
    centroid,
    anchor,
    ...(itemType === "workflow" && newItem.steps?.length ? { steps: newItem.steps } : {}),
  };
  syncConfidence(item, config);
  return item;
}

/**
 * Three-way merge: item1 + item2 + newItem → single combined entry.
 * Called when top-1 and top-2 both strongly match the same new observation
 * within the same category, confirming they describe the same behavior.
 */
export function combineThree(
  item1: any,
  item2: any,
  newItem: any,
  itemType: string,
  newEmb: number[],
  top1Score: number,
  config: ConfidenceConfig
): any {
  lazyMigrateAlpha(item1, config);
  lazyMigrateAlpha(item2, config);
  const freq = (item1.frequency || 1) + (item2.frequency || 1) + 1;
  const evidenceSources = [
    ...ensureArray(newItem.evidence),
    ...ensureArray(item1.evidence),
    ...ensureArray(item2.evidence),
  ];
  const evidence = [...new Set(evidenceSources)].slice(0, 10);
  const centroid = l2Normalize(
    item1.centroid.map(
      (v: number, i: number) =>
        THREE_WAY_CENTROID_W1 * v +
        THREE_WAY_CENTROID_W2 * (item2.centroid[i] ?? 0) +
        THREE_WAY_CENTROID_W3 * (newEmb[i] ?? 0)
    )
  );
  const anchor = item1.anchor;
  const newIsShorter = newItem.description.length < (item1.description?.length || Infinity);
  const description = top1Score > 0.9 && newIsShorter ? newItem.description : item1.description;
  const steps =
    itemType === "workflow" && (item1.steps || item2.steps)
      ? item1.steps?.length && item1.steps.length >= (item2.steps?.length || 0)
        ? item1.steps
        : item2.steps
      : newItem.steps;
  const result = {
    ...item1,
    description,
    frequency: freq,
    evidence,
    centroid,
    anchor,
    alpha: (item1.alpha || 1) + (item2.alpha || 1) + 1,
    beta: (item1.beta || 1) + (item2.beta || 1),
    weakAlpha: 1,
    weakBeta: 1,
    weakHitCount: 0,
    driftBelowCount: 0,
    lastSeen: Date.now(),
    lastMatchTime: Date.now(),
    ...(steps ? { steps } : {}),
  };
  syncConfidence(result, config);
  return result;
}
