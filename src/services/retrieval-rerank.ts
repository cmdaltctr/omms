/**
 * The reranker stage of memory search (openspec change
 * retrieval-threshold-and-reranker, design decision 7). vector-search.ts
 * sits at its file-size ceiling, so this module wraps the existing shard
 * search instead of changing it: one shard read with no threshold returns
 * the best candidates; the reranker reorders them; any failure falls back
 * to the normal threshold result. Pure plumbing only — the settings and the
 * search/fetch/log implementations are passed in, never imported from
 * CONFIG, so tests run without a store or a server.
 */
import type { SearchResult, ShardInfo } from "./turso/types.js";
import { RERANKER_POOL_SIZE } from "./request-timeouts.js";
import { rerankDocuments, type RerankerSettings } from "./reranker.js";

/** The shape of tursoVectorSearch.searchAcrossShards, injectable for tests. */
export type SearchAcrossShards = (
  shards: ShardInfo[],
  queryVector: Float32Array,
  containerTag: string,
  limit: number,
  similarityThreshold: number,
  queryText?: string
) => Promise<{ results: SearchResult[]; warnings: string[] }>;

export interface RerankedSearchOptions {
  shards: ShardInfo[];
  queryVector: Float32Array;
  containerTag: string;
  queryText: string;
  maxMemories: number;
  similarityThreshold: number;
}

export interface RerankedSearchDeps {
  search: SearchAcrossShards;
  fetchImpl?: typeof fetch;
  /** Defaults to silence; the real caller passes the shared logger. */
  log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * Search with an optional reranker. The shard search always runs once with a
 * threshold of 0 and a limit of max(maxMemories, pool size), so the same
 * read serves the reranked path and the fallback. The candidates come back
 * sorted by similarity, so applying the threshold and the limit to the same
 * list reproduces the no-reranker result exactly.
 */
export async function rerankedSearch(
  options: RerankedSearchOptions,
  settings: RerankerSettings,
  deps: RerankedSearchDeps
): Promise<{ results: SearchResult[]; warnings: string[]; reranked: boolean }> {
  const { search } = deps;
  const { results: candidates, warnings } = await search(
    options.shards,
    options.queryVector,
    options.containerTag,
    Math.max(options.maxMemories, RERANKER_POOL_SIZE),
    0,
    options.queryText
  );
  try {
    const { ordered } = await rerankDocuments(
      settings,
      options.queryText,
      candidates,
      deps.fetchImpl
    );
    return { results: ordered.slice(0, options.maxMemories), warnings, reranked: true };
  } catch (error) {
    // Metadata only: the code, the elapsed time, and the candidate count.
    // The query and any memory text never reach the log.
    const code =
      typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : "reranker_unreachable";
    const elapsedMs =
      typeof (error as { elapsedMs?: unknown })?.elapsedMs === "number"
        ? (error as { elapsedMs: number }).elapsedMs
        : 0;
    deps.log?.("Reranker failed; returning the threshold result", {
      code,
      elapsedMs,
      candidates: candidates.length,
    });
    return {
      results: candidates
        .filter((result) => result.similarity >= options.similarityThreshold)
        .slice(0, options.maxMemories),
      warnings,
      reranked: false,
    };
  }
}
