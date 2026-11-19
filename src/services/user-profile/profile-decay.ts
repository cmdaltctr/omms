import type { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { lazyMigrateAlpha, syncConfidence } from "./profile-confidence.js";
import type { UserProfileData } from "./types.js";

/** The config values the stale-item cleanup reads. Callers pass CONFIG. */
export type DecayConfig = Pick<
  typeof CONFIG,
  | "userProfileConfidenceDecayDays"
  | "userProfileStaleDays"
  | "userProfileWorkflowStaleDays"
  | "userProfileMinEvidenceForRetention"
>;

export function decayInMemory(
  data: UserProfileData,
  config: DecayConfig
): { data: UserProfileData; hasChanges: boolean } {
  const now = Date.now();

  const prefResult = decayItems(data.preferences, now, "preference", config);
  const patResult = decayItems(data.patterns, now, "pattern", config);
  const wfResult = decayItems(data.workflows, now, "workflow", config);

  return {
    data: {
      ...data,
      preferences: prefResult.items,
      patterns: patResult.items,
      workflows: wfResult.items,
    },
    hasChanges: prefResult.hasChanges || patResult.hasChanges || wfResult.hasChanges,
  };
}

function decayItems<T extends Record<string, any>>(
  items: T[],
  now: number,
  itemType: "preference" | "pattern" | "workflow",
  config: DecayConfig
): { items: T[]; hasChanges: boolean; before: number; removed: number } {
  const before = items.length;
  let hasChanges = false;

  const filtered = items.filter((item) => {
    lazyMigrateAlpha(item as any, config);

    if ((item as any).lastSeen === undefined) (item as any).lastSeen = now;
    if ((item as any).evidence === undefined) (item as any).evidence = [];

    const oldConf = (item as any).confidence;
    syncConfidence(item as any, config);
    if ((item as any).confidence !== oldConf) hasChanges = true;

    const age = now - ((item as any).lastSeen || now);
    const ageDays = age / (24 * 60 * 60 * 1000);
    const isWorkflow = itemType === "workflow";
    const itemStaleDays = config.userProfileStaleDays ?? 2;
    // A workflow never decays sooner than other items, even with a long userProfileStaleDays.
    const staleDays = isWorkflow
      ? Math.max(config.userProfileWorkflowStaleDays ?? 30, itemStaleDays)
      : itemStaleDays;
    const minEvidence = config.userProfileMinEvidenceForRetention ?? 3;
    const evidenceCount = Array.isArray((item as any).evidence) ? (item as any).evidence.length : 0;
    // The analysis schema gives workflows no evidence, so repeat sightings count instead.
    const support = isWorkflow
      ? Math.max(evidenceCount, (item as any).frequency ?? 1)
      : evidenceCount;

    // Remove inactive, low-evidence items using configured retention thresholds.
    if (ageDays > staleDays && support < minEvidence) {
      log("profile decay: removed stale", {
        cat: (item as any).category || (item as any).description?.substring(0, 30),
        evidenceCount: support,
        minEvidence,
        ageDays: Math.round(ageDays),
        staleDays,
      });
      hasChanges = true;
      return false;
    }

    return true;
  });

  return { items: filtered, hasChanges, before, removed: before - filtered.length };
}
