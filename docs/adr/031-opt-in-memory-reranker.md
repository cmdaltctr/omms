# ADR-031: The reranker is opt-in and the similarity threshold follows the embedder

- **Date:** 2026-10-17
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Evidence:** [Experiment 24](../../experiments/24-retrieval-memory-reranker-2026-10-17/report.md), [Experiment 25](../../experiments/25-retrieval-threshold-sweep-2026-10-17/report.md), [Experiment 26](../../experiments/26-retrieval-threshold-fresh-prompts-2026-10-17/report.md)

## Context

The default `similarityThreshold` of 0.6 hid relevant memories. In Experiments 24 to 26 (60 prompts, then 60 fresh prompts, `qwen3-embedding:0.6b`, one project), 21 to 22 of every 60 prompts got no memory at all. A threshold of 0.50 lifted recall@10 from 0.36 to 0.60 on the first set and from 0.54 to 0.88 on the fresh set, at a cost of 1.2 to 1.9 more irrelevant memories per prompt.

Experiment 24 also measured a cross-encoder reranker over the top 50 candidates. It added little over the lower threshold (+0.02 recall on one answer key, +0.10 on the other, neither significant) and took a median of 2.5 seconds per prompt plus a second model server. The evidence has limits: one embedder, one project, AI-made answer keys with operator spot checks, and overall validity INCONCLUSIVE.

## Decision

1. **The threshold default follows the embedder.** A value present in the file always wins and is never rewritten. When the key is absent, a small list in `src/utils/threshold-default.ts` (`defaultSimilarityThreshold`) returns 0.5 for `qwen3-embedding:0.6b` and its aliases, and 0.6 for every other embedder including the built-in one. Adding a measured embedder is one line in the list. The config template no longer writes a `similarityThreshold` line, so new files follow the embedder default.
2. **An explicit value is never migrated.** Most existing files hold the old template's `"similarityThreshold": 0.6`. An old default cannot be told apart from a choice, so the file keeps it. The Memory limits card gains a per-row **Reset to default** action that removes the key (for `chatMessage.maxMemories`, only the leaf) and a **Differs from default** marker.
3. **The reranker is opt-in, off by default, and shared.** `rerankerEnabled` (false), `rerankerApiUrl`, `rerankerModel`, `rerankerApiKey` (`env://` or `file://` only), and `rerankerTimeoutMs` (default 4000, range 500 to 30000) are global-only: a project file cannot redirect a user's memories to its own server. The search takes the 50 best candidates with no threshold, posts query and document text to `<url>/rerank` (`{model, query, documents, top_n}`, documents cut at 4,000 characters), orders by `relevance_score` with id tie-break, and keeps `maxMemories`. On any failure (unreachable, over timeout, HTTP error, invalid reply) it returns the normal threshold result and logs one metadata record: a code and the elapsed time, never query, memory text, or key.
4. **Constants.** `RERANKER_POOL_SIZE = 50` (no setting until evidence says otherwise), and the timeout bounds live in `src/services/request-timeouts.ts` with the other limits. The 4000 default keeps total search time inside OpenCode V2's 5-second wait for prompt retrieval; the card notes that a value over 5000 can make OpenCode V2 send the request with no memory.
5. **No bundled server.** OMMS never bundles, downloads, or starts a reranker model. The documentation shows a `llama-server --reranking` command for Qwen3-Reranker-0.6B and recommends a server on the same machine, because with the switch on the prompt and candidate memory text leave the process.

## Alternatives rejected

- **One global 0.5 default.** Simpler, but it ships an unmeasured value for the built-in embedder. Per-embedder table chosen instead.
- **Two saved per-embedder thresholds.** Two numbers for the user to keep in step; the file keeps one number and only the default varies.
- **Rewriting existing `0.6` lines at startup.** A silent edit of the user's file. Reset to default in the card instead.
- **Reranker on by default.** 2.5 seconds median per prompt against a 5-second host wait, for a gain the experiments could not distinguish from the threshold change alone.
- **A branch inside `searchAcrossShards`.** `vector-search.ts` is at its file-size ceiling, and the threshold would already have dropped the candidates the reranker should see. A separate `src/services/retrieval-rerank.ts` wraps the call with one shard read instead.
- **One adapter per reranker vendor.** Speculative; the `/rerank` contract matches llama.cpp, Jina, and Cohere-style servers.

## Consequences

- A user with no saved threshold who switches embedder gets a different effective threshold. The card shows the default for the current embedder and the docs say so; a saved value avoids the change.
- About 1.2 to 1.9 more irrelevant memories per prompt at 0.5 on the measured setup. `retrievalMaxTokens` still bounds the injected text.
- The evidence base is one embedder and AI-made answer keys (validity INCONCLUSIVE). The 0.5 default is a trial default that the card can undo, and the threshold table records where it came from.
- With the reranker on, the search reads up to 50 candidates per shard instead of `maxMemories`, a small extra database cost, and the default timeout will often fall back on small machines (Experiment 24 median 2.5 s).
