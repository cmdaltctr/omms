import { join } from "node:path";
import * as configModule from "../../config.js";
import type { LinkedOwner } from "../linked-search.js";
import type { DecayConfig } from "../user-profile/profile-decay.js";
import type { HistoryConfig } from "../user-profile/profile-history.js";
import type { ProfileConfig } from "../user-profile/profile-host.js";

/**
 * The store settings reader (design D5a "S"). Store singletons are created when their module
 * loads, before any edge runs, so they read their folder and embedding settings here, on every
 * call. Each function reads the live `CONFIG`: a reload or a memory space switch replaces it,
 * and a copy kept past one call would point at the old space. Keep this list fixed; a test
 * pins it. `config.ts` must never import this file.
 */

type Config = typeof configModule.CONFIG;

/** The values the user profile manager passes to its merge, decay, history and model checks. */
export type ProfileSettings = ProfileConfig & DecayConfig & HistoryConfig;

/**
 * Reads the active space the way partial test stubs allow: a `config.js` stub may
 * leave out `getActiveSpace`, and a missing one means the Default space.
 */
export function activeOwner(): LinkedOwner {
  return configModule.getActiveSpace?.() ?? { id: "default", customStoragePath: false };
}

/**
 * The active space's display name for the memory context header. A `config.js` stub may leave
 * out `getActiveSpace`, and a missing one means the Default space.
 */
export function getActiveSpaceLabel(): { name: string; customStoragePath: boolean } {
  const space = configModule.getActiveSpace?.();
  return {
    name: space?.name ?? "Default",
    customStoragePath: space?.customStoragePath ?? false,
  };
}

/** The storage folder of the active memory space. */
export function getStoragePath(): Config["storagePath"] {
  return configModule.CONFIG.storagePath;
}

/** The global storage folder for `skills.db` and the model cache. It does not follow the space. */
export function getSkillStoragePath(): string {
  return configModule.CONFIG.skillStoragePath ?? configModule.CONFIG.storagePath;
}

/** The embedding model cache. Every memory space shares it (ADR-041). */
export function getEmbeddingCacheDir(): string {
  return join(getSkillStoragePath(), ".cache");
}

export function getEmbeddingModel(): Config["embeddingModel"] {
  return configModule.CONFIG.embeddingModel;
}

export function getEmbeddingDimensions(): Config["embeddingDimensions"] {
  return configModule.CONFIG.embeddingDimensions;
}

export function getEmbeddingApiUrl(): Config["embeddingApiUrl"] {
  return configModule.CONFIG.embeddingApiUrl;
}

export function getEmbeddingApiKey(): Config["embeddingApiKey"] {
  return configModule.CONFIG.embeddingApiKey;
}

export function getEmbeddingUseTaskPrefixes(): Config["embeddingUseTaskPrefixes"] {
  return configModule.CONFIG.embeddingUseTaskPrefixes;
}

export function getMaxVectorsPerShard(): Config["maxVectorsPerShard"] {
  return configModule.CONFIG.maxVectorsPerShard;
}

/** The prefix in effect, after the default and the migration rule. */
export function getContainerTagPrefix(): Config["containerTagPrefix"] {
  return configModule.CONFIG.containerTagPrefix;
}

/** The prefix the config file sets itself, or undefined when it sets none. */
export function getExplicitContainerTagPrefix(): string | undefined {
  return configModule.getExplicitContainerTagPrefix();
}

export function getUserEmailOverride(): Config["userEmailOverride"] {
  return configModule.CONFIG.userEmailOverride;
}

export function getUserNameOverride(): Config["userNameOverride"] {
  return configModule.CONFIG.userNameOverride;
}

export function getAiSessionRetentionDays(): Config["aiSessionRetentionDays"] {
  return configModule.CONFIG.aiSessionRetentionDays;
}

/** A fresh object on each call, so the caller never keeps a copy of `CONFIG`. */
export function getProfileSettings(): ProfileSettings {
  const config = configModule.CONFIG;
  return {
    userProfileConfidenceDecayDays: config.userProfileConfidenceDecayDays,
    userProfileStaleDays: config.userProfileStaleDays,
    userProfileWorkflowStaleDays: config.userProfileWorkflowStaleDays,
    userProfileMinEvidenceForRetention: config.userProfileMinEvidenceForRetention,
    userProfileChangelogRetentionCount: config.userProfileChangelogRetentionCount,
    userProfileEmbeddingMinDescriptionLength: config.userProfileEmbeddingMinDescriptionLength,
    userProfileEmbeddingThresholdSameCat: config.userProfileEmbeddingThresholdSameCat,
    userProfileEmbeddingThresholdSameCatWeak: config.userProfileEmbeddingThresholdSameCatWeak,
    userProfileEmbeddingThresholdCrossCat: config.userProfileEmbeddingThresholdCrossCat,
    userProfileEmbeddingThresholdCrossCatWeak: config.userProfileEmbeddingThresholdCrossCatWeak,
    userProfileCentroidDriftThreshold: config.userProfileCentroidDriftThreshold,
    memoryModel: config.memoryModel,
    memoryApiUrl: config.memoryApiUrl,
    memoryApiKey: config.memoryApiKey,
  };
}
