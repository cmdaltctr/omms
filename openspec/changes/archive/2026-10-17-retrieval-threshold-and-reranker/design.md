# Design

## Context

See `proposal.md` for the reason. The evidence is in `experiments/24`, `25` and `26`.

- `searchAcrossShards` in `src/services/turso/vector-search.ts` sorts all hits by score, drops those below `similarityThreshold`, then keeps `limit`. `memoryClient.searchMemories` in `src/services/client.ts` calls it, and prompt retrieval (`src/core/retrieval.ts`) and the manual `memory` search (`src/core/memory-operations.ts`) both go through that one method. Every host therefore shares the search.
- `similarityThreshold` is already a `CONFIG` value, read from the global file or a project file. The config template in `src/config.ts` writes `"similarityThreshold": 0.6` into every new file, so existing users hold an explicit 0.6. The operator's own file was set to 0.5 by hand on 2026-10-17.
- The five memory limits share the rule table in `src/utils/memory-limits.ts`. Every rule is an integer rule with a fixed default, and the Memory card parser (`parseMemoryValue` in `web/src/lib/memory-controls.ts`) rejects non-integers.
- The settings writer treats `undefined` as "remove the key" for some keys, but the memory-limit rules refuse it, so no Memory limits row can be reset today.
- `src/config.ts` is 1,207 lines and listed in `tests/file-size-ceiling.test.ts` at that size. It may shrink but not grow.
- OpenCode V2 stops waiting for the prompt-time search after 5 seconds (`V2_RETRIEVAL_TIMEOUT_MS`) and sends the request with no memory.
- Embedding already has a remote form (`embeddingApiUrl`, `embeddingApiKey` as a secret reference). The reranker copies that shape.

## Goals / Non-Goals

**Goals:**

- Give each embedder the default that was measured for it, and let users edit and reset the value in the Memory limits card.
- Add a reranker that is off by default, shared by every host, and cannot make search worse when it fails.

**Non-Goals:**

- No bundled reranker model, server, download or launcher. The user runs the server.
- No migration of an explicit `similarityThreshold` in an existing file.
- No setting for the candidate pool (50). It is a constant until evidence says otherwise.
- No per-embedder values saved in the file. The file holds one number. Only the default depends on the embedder.
- No change to recent-memory or session-memory lists.

## Decisions

1. **The rule table gets one decimal rule, with a computed default.** `MemoryLimitRule.isValid` already takes a function, so `similarityThreshold` becomes a sixth entry with `isValid = number between 0 and 1`. Its `default` is no longer a fixed number: the rule carries a function `defaultFor(embeddingModel)` and the other five keep a constant. The writer, snapshot and schema pick it up through `getMemoryLimitRule` with no new branch. The card parser gains a per-control `kind` (`integer` or `decimal`). Alternative: a separate threshold card. Rejected, since one table with one save flow is what the spec already describes.

2. **The default follows the embedder through a small table.** A new pure module `src/utils/threshold-default.ts` exports `defaultSimilarityThreshold(embeddingModel)`. It lowercases the model name and returns 0.5 when the name is in a short list (`qwen3-embedding:0.6b`, `qwen/qwen3-embedding-0.6b`, `qwen/qwen3-embedding-0.6b-gguf:q8_0`), and 0.6 otherwise. `CONFIG.similarityThreshold` becomes `fileValue ?? defaultSimilarityThreshold(embeddingModel)`. The settings snapshot returns the same function's result as the row's `default`. The module never imports `CONFIG`, so tests that stub `src/config.js` stay valid. Alternatives: one global 0.5 (simpler, unmeasured for the built-in embedder), or two saved settings (two numbers for the user to keep in step). Rejected: the first ships a guess, the second adds a setting the user must maintain. Adding a measured embedder is one line in the list.

3. **An explicit value in the file is never rewritten.** A file with `0.6` keeps 0.6, because an old default cannot be told apart from a choice. Users select **Reset to default** in the card instead (decision 4). Alternative: rewrite `0.6` to 0.5 at startup. Rejected: silent edit of the user's file.

4. **Reset to default removes the key.** The settings save route accepts `null` for a memory-limit key to mean "remove". The writer deletes that key, or for `chatMessage.maxMemories` only the leaf, and keeps comments and other properties. The snapshot already returns `source` and `default`, so the card shows **Differs from default** when `source` is not `default` and the saved value is not equal to the default. The Reset button is disabled when the key is absent. It works for all six rows, since one rule table serves them.

5. **The template leaves `src/config.ts` first and drops the threshold line.** Task 1 moves `CONFIG_TEMPLATE` to `src/config-template.ts` and lowers the ceiling entry for `src/config.ts`, so the new keys fit without growing the file. The new template has no active `similarityThreshold` line, only a comment, so new files follow the embedder default. Alternative: raise the ceiling. Rejected by the repository rule.

6. **The reranker client is a pure module.** `src/services/reranker.ts` exports `rerankDocuments(settings, query, documents, fetchImpl)` and `rerankSettingsFrom(config)`. It never imports `CONFIG`. `client.ts` reads the settings from `CONFIG` once at the start of a search, as it does for `maxMemories`.

7. **Where it plugs in.** `src/services/turso/vector-search.ts` sits at its file-size ceiling (533 lines), so it does not change. A new function in `src/services/retrieval-rerank.ts` wraps the existing call. It calls `searchAcrossShards` once with a threshold of 0 and a limit of `max(maxMemories, 50)`, which returns the best candidates with no cut-off. With the reranker on, it reorders those candidates and keeps `maxMemories`. If the reranker is off or fails, it applies `similarityThreshold` and `maxMemories` to the same list, which gives the same result as today because the list is already sorted by score. One shard read serves both paths. With the reranker off, `client.ts` still calls `searchAcrossShards` with the real threshold and limit, so nothing changes for users who leave it off. Alternative: add a branch inside `searchAcrossShards`. Rejected: file-size ceiling, and the threshold would already have dropped the candidates the reranker should see.

8. **Endpoint contract.** `POST <url>/rerank` with `{model, query, documents, top_n}`; reply `{results: [{index, relevance_score}]}`. This matches llama.cpp `llama-server --reranking` (path `/v1/rerank`, so the URL is `http://127.0.0.1:3008/v1`), Jina, and Cohere-style servers. Experiment 24 used exactly this shape. Alternative: one adapter per vendor. Rejected as speculative.

9. **The reranker timeout is a setting.** `rerankerTimeoutMs`, default 2000, accepted range 500 to 30000, global-only, with a **Timeout** field in the Reranker card. Experiment 24 measured a median of 2.5 seconds and a p95 of 9.5 seconds on the operator's laptop, so a default of 2000 will often fall back on that hardware, and the operator will raise it. The default keeps total search time inside OpenCode V2's 5-second wait. A user who sets more than 5000 accepts that OpenCode V2 may send the request without memory. The card says so beside the field. The default and the range live in `src/services/request-timeouts.ts` with the other limits.

10. **Global-only settings.** The five reranker keys join `globalOnly` in `src/services/settings-snapshot.ts` and the project-file reader ignores them. A repository could otherwise ship a `.opencode/omms.jsonc` that sends a user's memories to its own URL.

11. **The card is on the Memory page.** The Profile learning card already sits there, so the sidebar tree and its tests do not change. The Test button calls a new route that sends two fixed sample documents, so no real memory text leaves during a test.

12. **One ADR.** `docs/adr/031-opt-in-memory-reranker.md` records the opt-in decision, the embedder default table, the constants and the rejected alternatives.

## Risks / Trade-offs

- **Silent default change when the embedder changes.** A user with no saved threshold who switches embedder gets a different effective threshold. The card shows the default for the current embedder, and the docs say so. A saved value avoids this.
- **Model names.** The table matches model names, and one embedder can have several names (alias, repository name, quantisation). A name not in the list gets 0.6, which is the safe old behaviour. The list can grow.
- **Existing `0.6` lines.** Most existing files hold an explicit 0.6 from the old template and keep it until the user selects Reset to default. The release notes and the card's marker say so.
- **Noise.** About 1.2 to 1.9 more irrelevant memories per prompt at 0.5 (Experiments 25 and 26). `retrievalMaxTokens` still bounds the injected text.
- **AI-made answer keys.** Experiments 24 to 26 used AI labels checked by the operator on small samples (16 of 20, then 23 of 40). Validity is INCONCLUSIVE. This change adopts the threshold as a trial default that the card can undo.
- **Reranker delay.** At 2.5 seconds median the default timeout will often fall back on small machines. A timeout costs the full timeout before the fallback.
- **Privacy.** With the switch on, prompts and candidate memories leave the process. The card and docs say so, and the settings are global-only.
- **Larger shard read.** With the reranker on, the search reads up to 50 candidates per shard instead of `maxMemories`. This costs a little extra database time on each search.
