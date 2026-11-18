import type { CONFIG } from "../../config.js";
import type { rankProfileCandidates } from "./profile-candidate-matching.js";
import type { ColdBuffer } from "./profile-cold-buffer.js";

/** The config values the merge, dedupe and evolve modules read. The manager passes CONFIG. */
export type ProfileConfig = Pick<
  typeof CONFIG,
  | "userProfileConfidenceDecayDays"
  | "userProfileEmbeddingMinDescriptionLength"
  | "userProfileEmbeddingThresholdSameCat"
  | "userProfileEmbeddingThresholdSameCatWeak"
  | "userProfileEmbeddingThresholdCrossCat"
  | "userProfileEmbeddingThresholdCrossCatWeak"
  | "userProfileCentroidDriftThreshold"
  | "memoryModel"
  | "memoryApiUrl"
  | "memoryApiKey"
>;

/**
 * What the merge, dedupe and evolve modules call back on the manager. Each call
 * goes through the manager instance, so a test that replaces one of its methods
 * still changes the result.
 */
export interface ProfileHost {
  readonly config: ProfileConfig;
  /** Description pairs the model already judged not duplicate. */
  readonly dedupCheckedCache: Set<string>;
  getColdBuffer(profileId?: string): ColdBuffer;
  saveColdBuffers(): void;
  detectConflicts(items: any[], itemType: string, profileId: string): Promise<void>;
  checkConflict(descA: string, descB: string): Promise<boolean>;
  checkSemanticDuplicate(descA: string, descB: string): Promise<boolean>;
  evolveDescription(
    item: any,
    itemType: "preference" | "pattern" | "workflow",
    profileId?: string
  ): Promise<string | null>;
  evolveAndUpdate(item: any, itemType: string, profileId?: string): Promise<void>;
}

export type MergeableItem = { category?: string; description: string };

/** Values fixed for one merge pass. */
export interface MergeRun {
  itemType: "preference" | "pattern" | "workflow";
  isWorkflow: boolean;
  profileId?: string;
  sameCatStrong: number;
  driftThreshold: number;
}

/** How many items a match branch merged and how many it appended. */
export interface MergeOutcome {
  matched: number;
  added: number;
}

export type CandidateRank = ReturnType<typeof rankProfileCandidates>;
