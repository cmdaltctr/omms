import { tursoVectorSearch } from "../../turso/vector-search.js";
import type { KeywordMode } from "../../../utils/keyword-boost.js";
import type { MemoryKind } from "../../memory-kind.js";
import type { SearchResult, ShardInfo, ShardOpener } from "./types.js";

/**
 * Vector search over memory shards. The parameters follow the engine's order and defaults
 * one for one: an omitted argument takes the engine's default, so a caller that moves here
 * gets the same results in the same order.
 */

/** Searches every shard, merges, applies the threshold and the limit. Fails only when all shards fail. */
export function searchMemoryShards(
  shards: ShardInfo[],
  queryVector: Float32Array,
  containerTag: string,
  limit: number,
  similarityThreshold: number,
  queryText?: string,
  keywordBoost?: number,
  keywordMode?: KeywordMode,
  open?: ShardOpener,
  kind?: MemoryKind
): Promise<{ results: SearchResult[]; warnings: string[] }> {
  return tursoVectorSearch.searchAcrossShards(
    shards,
    queryVector,
    containerTag,
    limit,
    similarityThreshold,
    queryText,
    keywordBoost,
    keywordMode,
    open,
    kind
  );
}

/** Searches one shard, without a threshold. Throws when the shard cannot be read. */
export function searchMemoryShard(
  shard: ShardInfo,
  queryVector: Float32Array,
  containerTag: string,
  limit: number,
  queryText?: string,
  keywordBoost?: number,
  keywordMode?: KeywordMode,
  open?: ShardOpener,
  kind?: MemoryKind
): Promise<SearchResult[]> {
  return tursoVectorSearch.searchInShard(
    shard,
    queryVector,
    containerTag,
    limit,
    queryText,
    keywordBoost,
    keywordMode,
    open,
    kind
  );
}
