## Context

- `buildRetrievalSection` (`src/core/retrieval.ts:16`) calls `memoryClient.searchMemories`, then `formatContextForPrompt(userEmail, { results }, budget)`. Claude Code reaches it through `src/importer/claude-hook-api.ts:215`, OpenCode V2 through `src/v2/memory-bridge.ts:57`, and Pi through `src/adapters/pi/extension.ts:282`.
- `searchInShard` (`src/services/turso/vector-search.ts`) finds candidates with two DiskANN indexes (content and tag vectors), hydrates each with exact distances, and scores `0.6 × content + 0.4 × max(tag vector, tag word match)`. The reranker and the similarity threshold (default 0.5) sit after it. `vector-search.ts` is 519 lines and may not grow (`tests/file-size-ceiling.test.ts`).
- Shard tables are created with `CREATE … IF NOT EXISTS` in `src/services/turso/shard-manager.ts` (616 lines, also frozen). `memories` has a TEXT primary key and an implicit `rowid`, which the vector index already joins on.
- FTS5 works in the bundled `@libsql/client` (checked: a `unicode61` table matches `adr` in `ADR-023`).
- Profile items hold `centroid` and `anchor` vectors (`src/services/user-profile/types.ts`). `getUserProfileContext` ignores them. The web API strips them, the store keeps them.

## Goals / Non-Goals

**Goals:**

- Exact words in a prompt can lift a memory, and can bring a memory into the candidate list.
- The profile block follows the prompt, with a stable core.
- No extra model call, no extra embedding call, and no visible added delay.

**Non-Goals:**

- A model step in the hooks (ADR-033).
- Reciprocal rank fusion as the default or as a replacement for the boost. It replaces scores with ranks and breaks the meaning of the similarity threshold and the reranker input. It is offered only as an experimental option (Decision 9).
- Chinese or Japanese word search through the keyword index (see Decision 2).
- Changing session-start injection (`buildRecentMemoriesSection`). It has no prompt.

## Decisions

1. **An additive keyword boost, not rank fusion.** The final similarity is `min(1, base + keywordBoost × k)`, where `k` is the memory's BM25 score divided by the best BM25 score in that search (0 to 1), and `base` is today's score. The scale stays 0 to 1, so the threshold, the reranker pool, and the `searchMemories` result shape keep their meaning. `keywordBoost` defaults to 0.1 (task 3.3, below). `0` skips the index and the code path.

   **Measured (task 3.1) and chosen (task 3.3).** 20 saved prompts ran offline against a copy of the largest shard (2,161 memories) with the local embedder and no model call. The table counts memories that entered or left the top 10 compared with `keywordBoost: 0`. The slowest search took 111 ms.

   | `keywordBoost` | Gained | Lost | Prompts changed |
   | -------------- | ------ | ---- | --------------- |
   | 0.10           | 55     | 50   | 17              |
   | 0.15           | 76     | 71   | 18              |
   | 0.25           | 94     | 85   | 20              |

   Some gains were on topic (a prompt about `graphify` brought in graphify memories). Others were weak: a prompt that named `agents.md` pulled in a memory that shares only common words. The cause is the scaling: the best keyword match always gets the full boost, even when it matched only common words. The user approved 0.10 because it moves the fewest memories and keeps this scaling. Published hybrid-search guides weight keywords more (often 0.3), but they tune on labelled data, and this store has none, so the smallest useful boost is the safe start. Task 6.1 checks real prompts for weak matches. A stronger fix (a boost that depends on match strength) and rank fusion (RRF, with the similarity cut-off applied first) are separate follow-ups; the second one gets an experiment on the Experiment 24 prompts after this change.

2. **Tokenizer `unicode61`.** It splits `ADR-023` into `adr` and `023`, handles accents and Arabic, and the query joins its words with OR. It does not split Chinese or Japanese. The trigram tokenizer handles those but not two-character words and makes a larger index. Task 3.2 compared both and kept `unicode61`.

   **Measured (task 3.2).** The store holds 4 memories with Chinese text and none with Arabic (6,540 memories in 60 shards), so the Arabic check used 3 short invented sentences. Recall on that sample, `unicode61` against `trigram`:

   | Query                                    | `unicode61` | `trigram` |
   | ---------------------------------------- | ----------- | --------- |
   | Chinese, whole run of characters         | 3/4         | 2/4       |
   | Chinese, 2 characters inside a run       | 0/2         | 0/2       |
   | Chinese, 3 characters inside a run       | 0/1         | 1/1       |
   | Arabic, whole word                       | 3/3         | 3/3       |
   | Arabic, word searched without its prefix | 0/1         | 1/1       |

   On the real 2,161-memory shard, `trigram` found nothing for the two-letter tag `ui` (`unicode61`: 94 memories), took about 8 times longer to build (158 ms against 20 ms), and made an index about 7 times larger. `trigram` is better for Chinese substrings and Arabic prefixes, but the sample is too small to show a large gain and nearly all memories are English. `unicode61` stays; vectors and tag matching still cover Chinese and Arabic prompts. Revisit when the store holds more of them.

3. **External-content FTS table with triggers.** `memories_fts` indexes `content` and `tags` with `content='memories'` and `content_rowid='rowid'`. Insert, update, and delete triggers keep it in step. No memory text is stored twice.
4. **Build on first open, guarded.** When a shard opens without `memories_fts`, or its row count differs from `memories`, OMMS creates the table and runs `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` in one transaction. A failure logs a code and leaves the shard in vector-only mode. Search never fails because of the index.
5. **New module, thin hook.** `keyword-search.ts` holds the table setup, the query builder (escapes FTS syntax, drops one-character words and stop-like tokens), the search, and the boost. `searchInShard` calls it where it now calls `tagMatchBoost`, adds the keyword-only ids to the candidate set, and adds the boost. Any extra lines in `vector-search.ts` are offset by moving code into the new module.
6. **Profile selection: half by relevance, half by today's order.** For each section the injected count stays as it is (5 preferences, 5 patterns, 3 workflows). `ceil(n / 2)` slots go to the items closest to the prompt by cosine similarity to `anchor` (or `centroid`), with a minimum similarity. The remaining slots keep today's order. The one-per-category rule stays. An item with no vector keeps only the today's order. Alternatives: all slots by relevance (loses stable preferences such as language and package manager), or relevance as a score boost (hard to explain and test).
7. **No second embedding.** `searchMemories` returns the `queryVector` it already computed. `buildRetrievalSection` passes it to `formatContextForPrompt`, which passes it to `getUserProfileContext`. When the vector is missing (search failed), the profile block uses today's order.
8. **Pure, testable pieces.** `profile-relevance.ts` and the query builder are pure functions that take their settings as arguments, so tests need no store and no `CONFIG`.

9. **`keywordMode`: an experimental rank fusion option.** The default stays `boost`. `rrf` builds a meaning list (similarity at or above the threshold) and a word list (at most 40 hits), merges them by reciprocal rank fusion with constant 60, and keeps each result's own similarity. A word match below the cut-off can enter, which the boost cannot do. The logic lives in a pure module, `src/services/turso/rank-fusion.ts`, because `vector-search.ts` is near its size limit; the merge runs across shards after the per-shard searches, in `searchAcrossShards`, so each shard returns its candidates with their word scores. The reranker needs a full candidate pool and a similarity scale, so while it is on, search uses `boost`. Word scores from different shards are not strictly comparable, because BM25 depends on the words of each shard; the fusion uses rank, and the cap of 40 applies per shard. Experiment 27 was inconclusive on RRF (gate G6), so the option is labelled "(experimental)" and Experiment 28 is planned to settle it. `keywordBoost` stays a config-file setting. Only `keywordMode` appears on the Memory page.

## Risks / Trade-offs

- [`keywordMode: rrf` is new and unproven] → default is `boost`, the page and docs say "experimental", and Experiment 27 and 28 hold the evidence. Removing the option later needs only a config note.
- [The boost can lift a weak memory that shares a common word] → The boost is bounded, BM25 favours rare words, and task 3.3 compared results on saved prompts and set the default to 0.1. `keywordBoost: 0` is the switch.
- [Index build time on a large shard (the largest has 2,161 memories)] → The rebuild is one SQL statement. Task 2.3 times it on a copy of a large shard.
- [The first search after upgrade pays the build] → It runs once per shard. The hook has a 10-second limit, so task 2.3 checks the worst case. If it is too slow, the build moves to a background step and the first search is vector-only.
- [Chinese and Japanese keyword matching is weak] → Vectors and tag matching still apply. Decision 2 and task 3.2 decide the tokenizer.
- [Half-by-relevance can drop a preference that mattered] → The stable half keeps the top items. The log line records counts only, so a missed item can be traced to the setting.
- [The new table adds a little disk per shard] → It stores terms and positions, not a second copy of the text. Task 2.3 reports the size.

**Measured (task 2.3, copy of the largest shard by file size, 134 MB, 2,161 memories):** first build 0.3 s, extra size 1.45 MB, a keyword search after the build 1 ms, the up-to-date check 0 ms. The build is under the 2-second limit, so it stays in the first search and no background step is added. Across the 60 project shards (6,540 memories) the largest by row count is this same shard, so the earlier figure of about 3,100 memories was too high.

**Measured (task 6.1, built app on port 4799, `keywordBoost` 0 against 0.1, 5 saved prompts of this project).** The run used a copy of the store, not the live one, because the first search with the boost on creates `memories_fts` in each shard, and that is a write. No model call was made. Every request returned 200 and `keyword_index_failed` never appeared in the log.

| Prompt | Memories off / on | Gained / lost | Profile items off / on | Hook time off / on (ms) |
| ------ | ----------------- | ------------- | ---------------------- | ----------------------- |
| 1      | 6 / 5             | 2 / 3         | 2 / 2                  | 752 / 490               |
| 2      | 4 / 4             | 0 / 0         | 3 / 3                  | 323 / 249               |
| 3      | 6 / 5             | 1 / 2         | 5 / 5                  | 262 / 234               |
| 4      | 4 / 4             | 0 / 0         | 5 / 5                  | 274 / 243               |
| 5      | 5 / 4             | 1 / 2         | 2 / 2                  | 252 / 243               |

The first request of each run is slower because the process is cold; a second run with the boost on gave 432 to 235 ms. The profile log line showed 3 of 5 preferences, 3 of 5 patterns and 2 of 3 workflows chosen by relevance. None of the 5 prompt fragments checked appears in the log (0 hits).

## Migration Plan

Nothing to run. Shards upgrade on first open. To roll back, set `keywordBoost` to `0`. An older OMMS ignores the extra table.

## Open Questions

- None. The default `keywordBoost` (0.1) and the tokenizer (`unicode61`) are fixed by tasks 3.2 and 3.3. Neither changes the specs.
