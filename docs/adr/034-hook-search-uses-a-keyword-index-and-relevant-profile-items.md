# ADR-034: Hook search uses a keyword index and relevant profile items, with no model call

- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** `hook-search-keywords-and-profile` (archived: `openspec/changes/archive/2026-10-18-hook-search-keywords-and-profile/`)

## Context

[ADR-033](./033-chat-uses-the-model-to-plan-search-hooks-do-not.md) kept model calls out of the hooks and promised a separate change for better hook search. Before this change, retrieval scored each memory as 0.6 × content similarity + 0.4 × tag similarity. A prompt that named an exact word, such as `ADR-023` or a tool name, found it only when the vectors happened to agree. The profile block was the same for every prompt.

The hooks run on every prompt in three hosts with a 10-second limit. They cannot spend a model call or a second embedding.

## Decision

1. **Add an FTS5 keyword index to each project shard.** `memories_fts` is an external-content table over `content` and `tags`, with the `unicode61` tokenizer and three triggers. It is built on the first search in a shard, kept current by the triggers, and rebuilt when it is missing or holds a different number of memories than `memories`. A failed build logs a code and search continues with vector and tag results.
2. **Add a bounded, additive boost.** The final similarity is `min(1, base + keywordBoost × min(1, score ÷ best))`. The scale stays 0 to 1, so `similarityThreshold` and the reranker keep their meaning. `keywordBoost` is a number from 0 to 0.5. The default is 0.1. `0` skips the index and the code path.
3. **Choose half of each profile section by relevance.** `ceil(count ÷ 2)` slots go to the items closest to the prompt by cosine similarity to `anchor` (or `centroid`), with a minimum closeness equal to `similarityThreshold`. The rest keep the usual order. The one-per-category rule stays for preferences and patterns.
4. **Reuse the prompt vector.** `searchMemories` returns the `queryVector` it already computed, and it reaches the profile step through `buildRetrievalSection` and `formatContextForPrompt`. The hooks make no model call and no extra embedding.

5. **Offer rank fusion as an experimental option.** `keywordMode` is `boost` (default) or `rrf`. In `rrf` mode search merges a meaning list (at or above `similarityThreshold`) and a word list (at most 40 hits) by reciprocal rank fusion with constant 60, in the pure module `rank-fusion.ts`. A word match below the cut-off can be returned. Each result keeps its own similarity. While the reranker is on, search uses `boost`. The Memory page shows the choice with the label "(experimental)"; `keywordBoost` stays a config-file setting. Experiment 27 did not show a gain worth a default (see Revisit Triggers), so the default stays `boost`.

## Consequences

**Positive**

- A prompt that names an exact word finds the memory that holds it.
- The profile block follows the prompt, and stable preferences stay in the other half.
- Cost per prompt is one SQL query. On a copy of the largest shard (2,161 memories) the first build took 0.3 s, added 1.45 MB, and a keyword search took 1 ms.

**Negative**

- On 20 saved prompts, a boost of 0.1 moved 55 memories into the top 10 and 50 out. Some gains were weak, because the best keyword match always gets the full boost, even when it matched only common words.
- `unicode61` does not split Chinese or Japanese text, so keyword matching is weak there. Vectors and tags still apply.
- Each project shard holds one more table.

**Neutral**

- Rolling back needs only `keywordBoost: 0`. An older OMMS ignores the extra table.

## Alternatives Considered

| Option                                          | Rejected because                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model keyword extraction in the hooks           | Adds a model call to every prompt ([ADR-033](./033-chat-uses-the-model-to-plan-search-hooks-do-not.md))                                                         |
| Reciprocal rank fusion (RRF) as the default     | RRF scores have no absolute scale, so the threshold would need redesign. Experiment 27 did not show a gain worth a default. It ships as an experimental option. |
| `trigram` tokenizer                             | About 8 times slower to build, an index about 7 times larger, and no match for two-letter words such as `ui`                                                    |
| Choose all profile slots by relevance           | Loses stable preferences such as language and package manager                                                                                                   |
| Use relevance as a score boost on profile items | Hard to explain and to test                                                                                                                                     |

## Revisit Triggers

- The live check (task 6.1) or later use shows weak common-word matches in the top results. Then change the boost to depend on match strength.
- A repeat of Experiment 27 with one judge for every pair (Experiment 28, planned) shows RRF raising recall@10 by 0.05 or more over the boost on both prompt sets. Experiment 27 was inconclusive (judge gate failed): the boost gained +0.08 recall@10 over meaning alone, and RRF's extra +0.06 came with 0.8 more irrelevant memories per prompt and shrank to +0.003 under a sensitivity check. Then drop the "(experimental)" label and decide whether `rrf` should become the default.
- The store holds enough Chinese, Japanese or Arabic text to make `trigram` worth its cost.

## References

- [ADR-033](./033-chat-uses-the-model-to-plan-search-hooks-do-not.md)
- [TDR-057](../tdr/057-count-on-an-external-content-fts-table-reads-the-content-table.md)
- `src/services/turso/keyword-search.ts`, `src/services/turso/vector-search.ts`, `src/services/user-profile/profile-relevance.ts`, `src/utils/keyword-boost.ts`
- [Configuration: Keyword matching](../configuration.md#keyword-matching)
