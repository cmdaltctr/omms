export const EXTERNAL_PROFILE_CLEANUP_TIMEOUT_MS = 60_000;
export const OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS = 300_000;

/** The most items one web AI cleanup request sends, so each request ends inside its time limit. */
export const AI_CLEANUP_BATCH_SIZE = 100;

const HTTP_TIMEOUT_GRACE_MS = 30_000;

export const NODE_HTTP_IDLE_TIMEOUT_MS =
  Math.max(EXTERNAL_PROFILE_CLEANUP_TIMEOUT_MS, OPENCODE_PROFILE_CLEANUP_TIMEOUT_MS) +
  HTTP_TIMEOUT_GRACE_MS;

/**
 * Upper bound an OpenCode v2 model request waits for the per-prompt memory
 * search started in the `prompt` hook. On timeout the request proceeds
 * without memory rather than stalling the agent.
 */
export const V2_RETRIEVAL_TIMEOUT_MS = 5_000;

// Opt-in reranker (openspec change retrieval-threshold-and-reranker). The
// default keeps total search time inside OpenCode V2's 5-second wait; a user
// who sets more than 5000 accepts that V2 may send the request with no memory.
export const RERANKER_TIMEOUT_DEFAULT_MS = 4_000;
export const RERANKER_TIMEOUT_MIN_MS = 500;
export const RERANKER_TIMEOUT_MAX_MS = 30_000;

/** Candidates the reranker sees per search. A constant until evidence says otherwise. */
export const RERANKER_POOL_SIZE = 50;
