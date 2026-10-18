# Tasks

## 1. Query builder and boost (pure)

- [x] 1.1 Write failing tests for `src/services/turso/keyword-search.ts` pure parts: the query builder lower-cases, splits `ADR-023` into `adr` and `023`, drops one-character words, quotes every term, and returns null for no usable term; syntax words and characters (`"`, `*`, `(`, `AND`, `NEAR`) never become syntax; the boost is `keywordBoost × score ÷ best score`, 0 when `keywordBoost` is 0, and capped so similarity never passes 1. Verify: tests fail before 1.2.
- [x] 1.2 Implement the query builder and `applyKeywordBoost` with the setting passed in, not imported. Verify: 1.1 passes, and breaking the cap or the quoting makes a test fail.

## 2. Keyword index in the shard

- [x] 2.1 Write failing tests against a temporary shard: after inserting memories, a search finds a memory by a word in its text and in its tags; an edit that removes the word and a delete both remove the match; a shard created with the old schema gets the index on first search and keeps all its memories; a row-count mismatch triggers a rebuild; a forced index error leaves vector and tag results. Verify: tests fail before 2.2.
- [x] 2.2 Implement the `memories_fts` table (external content, `unicode61`), the three triggers, the guarded build, and the keyword search in `keyword-search.ts`. Call it from `searchInShard` where `tagMatchBoost` is called, add keyword-only ids to the candidate set, and add the boost. Move code out of `vector-search.ts` so it does not grow. Verify: 2.1 passes, `tests/turso-vector-search.test.ts` and `tests/file-size-ceiling.test.ts` pass.
- [x] 2.3 Time the first build on a copy of the largest real shard (about 3,100 memories) and report the time and the extra size. Work on a copy in the scratch folder, not the store. Verify: numbers recorded in the notes; if the build takes more than 2 seconds, move it to a background step and record the change in `design.md`.
- [x] 2.4 Add the `keywordBoost` setting (0 to 0.5, default from 3.3) to the config and its validation, outside the modules that must not import `CONFIG`. Verify: a test refuses 0.6 and accepts 0; `docs/configuration.md` lists it.

## 3. Choose the tokenizer and the default

- [x] 3.1 Write an offline script in the scratch folder that runs saved real prompts through search on a copy of the store, with the boost off and on, and lists the memories that gain or lose a place in the top results. It makes no model call and does not print memory text outside the scratch folder. Verify: the script runs on 20 prompts.
- [x] 3.2 Compare `unicode61` and `trigram` on a Chinese and Arabic sample from the store. Verify: result recorded in `design.md` Decision 2.
- [x] 3.3 Choose the default `keywordBoost` from 3.1, then read the gained and lost memories with the user. Verify: the default and the evidence are recorded in `design.md`, and the user has approved the default.

## 4. Relevant profile items

- [x] 4.1 Write failing tests for `src/services/user-profile/profile-relevance.ts`: half of each section, rounded up, comes from the closest items; the rest keeps the existing order; the one-per-category rule and the counts stay; items without vectors only use the existing order; nothing below the minimum closeness takes a relevance slot; no prompt vector gives the existing block. Verify: tests fail before 4.2.
- [x] 4.2 Implement `profile-relevance.ts` as pure functions (vector, items, counts, and the minimum closeness passed in). Verify: 4.1 passes, and breaking the half split or the fallback fails a test.
- [x] 4.3 Return `queryVector` from `searchMemories`, pass it through `buildRetrievalSection` and `formatContextForPrompt` to `getUserProfileContext`, and use `profile-relevance.ts` there. Keep `buildRecentMemoriesSection` unchanged. Add counts to the log line. Verify: tests for the three call paths pass (a prompt, session start, and a failed search), the embedding call count is unchanged, and the existing `tests/` that mock `searchMemories` still pass.

## 5. Docs and records

- [x] 5.1 Update `docs/using-memory.md` (what search matches now, what the profile block shows) and `docs/configuration.md` (`keywordBoost`). Verify: Prettier passes, and grep finds no doc that still says the profile block is the same for every prompt.
- [x] 5.2 Write ADR-034 (keyword index and relevant profile items, no model call in the hooks) and a TDR for any fault found while building. Add both to their indexes. Verify: every link resolves.

## 6. Check

- [x] 6.1 Live check, read-only: run retrieval for 5 real prompts through the built app on a second port against the real store, with the boost on and off. Verify: counts of memories and profile items per prompt, hook time, and a log with no prompt text. No model call is made.
- [x] 6.2 Run `bun run ci:local`. Verify: exit 0.

## 7. Experimental rank fusion mode

- [x] 7.1 Write tests for `rank-fusion.ts` first (pure: two ranked lists, constant 60, top N, ties by id, a word-only item can enter, an item in both lists wins). Verify: the tests fail on a stub, and breaking the constant, the tie rule or the list merge fails a test.
- [x] 7.2 Add the `keywordMode` setting (`boost` or `rrf`, default `boost`) in a new pure helper outside `config.ts` (which is near its size limit), wire it into `config.ts` and `docs/configuration.md`. Verify: a test accepts both values, refuses `fusion`, and the default is `boost`.
- [x] 7.3 Use `rank-fusion.ts` in `searchAcrossShards` when `keywordMode` is `rrf` and `keywordBoost` is above 0, with the meaning list cut at `similarityThreshold`. Use `boost` when the reranker is on. Verify: shard tests show a word match below the cut-off returned in `rrf` mode and not in `boost` mode; `keywordBoost: 0` equals the old results in both modes; reranker on equals `boost`. No model call, no extra embedding.
- [x] 7.4 Add `keywordMode` to the settings snapshot and the global config writer (validation and the accepted-values message). Verify: tests for a save, a refused value, and a reset.
- [x] 7.5 Add a `keywordMode` control to the Memory page, labelled with "(experimental)", with English and Arabic text and a note when the reranker is on. Verify: component tests, `bun run check`, and a browser check at phone width.
- [x] 7.6 Update `docs/configuration.md`, `docs/web-ui-memory.md`, `docs/using-memory.md`, and ADR-034 (the option and its experimental label). Verify: Prettier passes, every link resolves.
- [x] 7.7 Run `bun run ci:local` and `openspec validate hook-search-keywords-and-profile --strict`, then verify again. Verify: exit 0 and no critical issues.
