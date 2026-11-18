import type { CONFIG } from "../config.js";
import {
  linkedSettingsFrom,
  type LinkedSearchSettings,
  type MemoryReadOptions,
} from "./linked-search.js";
import { log } from "./logger.js";
import { rerankSettingsFor } from "./reranker.js";

/**
 * The settings one memory search reads. The caller passes `CONFIG` at call time;
 * the client never keeps it.
 */
export type MemorySearchConfig = Pick<
  typeof CONFIG,
  | "maxMemories"
  | "similarityThreshold"
  | "keywordBoost"
  | "keywordMode"
  | "embeddingDimensions"
  | "embeddingModel"
  | "skillStoragePath"
  | "storagePath"
  | "rerankerEnabled"
  | "rerankerApiUrl"
  | "rerankerModel"
  | "rerankerApiKey"
  | "rerankerTimeoutMs"
>;

export interface MemorySearchOptions extends MemoryReadOptions {
  config: MemorySearchConfig;
}

/** A list reads linked spaces only when asked, so only then does it need their settings. */
export type MemoryListOptions = Omit<MemoryReadOptions, "includeLinked"> &
  (
    | { includeLinked?: false; linked?: undefined }
    | { includeLinked: true; linked: LinkedSearchSettings }
  );

/**
 * The result count and the reranker settings, read at entry: initialize,
 * embedding, and shard reads all await, and a config edit during them must not
 * change this search's limit or reranker target.
 */
export function searchEntrySettings(config: MemorySearchConfig, options: MemoryReadOptions) {
  const reranker = rerankSettingsFor(config, options.reranker);
  // On but incomplete, through the general switch or a search's own override:
  // search must keep working, so treat the reranker as off and say so once.
  if (
    !reranker &&
    (options.reranker === true || (config.rerankerEnabled && options.reranker !== false))
  ) {
    log("Reranker asked for without a URL or model; searching without it", {
      code: "reranker_not_configured",
    });
  }
  return {
    maxMemories: options.limit ?? config.maxMemories,
    keywordBoost: config.keywordBoost,
    // The reranker path always uses the boost: it needs a full pool on the similarity scale.
    keywordMode: config.keywordMode,
    reranker,
  };
}

/** Linked settings for one search; a search's own limit replaces `maxMemories`. */
export function linkedSearchSettings(
  config: MemorySearchConfig,
  limit: number | undefined
): LinkedSearchSettings {
  return limit === undefined
    ? linkedSettingsFrom(config)
    : { ...linkedSettingsFrom(config), maxMemories: limit };
}
