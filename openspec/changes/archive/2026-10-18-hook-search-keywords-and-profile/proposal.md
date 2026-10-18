## Why

Memory retrieval in Claude Code, OpenCode, and Pi has two weak points. Search finds memories by meaning (vectors) and by tag, but not by exact words, so a prompt that names `ADR-023`, a file name, or a rare term can miss the memory that holds it. The user profile block is the same for every prompt: the top preferences, patterns, and workflows by confidence or frequency, whatever the prompt is about.

The chat feature already plans its search with the model (ADR-033). The hooks run on every prompt, and each host already runs its own AI, so they must not add a model call. This change improves both weak points with no model call.

## What Changes

- Search gains a keyword index (SQLite FTS5) beside the vector index in every project shard. A memory that contains a word from the prompt gains a bounded boost. A memory found only by keyword becomes a candidate.
- The keyword index is derived data. OMMS builds it for existing shards on first open and keeps it in step with saves, edits, and deletes.
- The profile block picks part of each section by relevance to the prompt, using the vectors profile items already hold. The rest keeps today's order, so general preferences stay.
- `buildRetrievalSection` (the one function all three hosts call) passes the prompt vector to the profile step. The prompt is embedded once, as today.
- One setting, `keywordBoost`, sets the size of the boost. `0` turns the keyword part off.
- A second setting, `keywordMode`, picks how word matches join the results: `boost` (default) or `rrf` (reciprocal rank fusion, merging a meaning list and a word list by rank). `rrf` is experimental. It is shown on the Memory page with the label "(experimental)" and is ignored while the reranker is on.
- No model call is added to any hook. No change to the chat page.

## Capabilities

### New Capabilities

- `keyword-memory-search`: exact-word matching in memory search, with a derived index and a bounded effect on scores.
- `relevant-profile-injection`: choosing profile items for the injected block by relevance to the prompt.

### Modified Capabilities

None.

## Impact

- Storage: a new FTS5 table and three triggers in each project shard (`memories_fts`). Derived, rebuilt when missing.
- Code: new modules `src/services/turso/keyword-search.ts` and `src/services/user-profile/profile-relevance.ts`. Small edits in `src/services/turso/vector-search.ts` (frozen at its size limit, so any growth moves into the new module), `src/services/client.ts`, `src/core/retrieval.ts`, `src/services/context.ts`, and `src/services/user-profile/profile-context.ts`. Config: `keywordBoost` and `keywordMode`. A new pure module `src/services/turso/rank-fusion.ts`. The settings snapshot, the global config writer, and the Memory page (`web/`) gain `keywordMode`.
- Hosts: the shared core serves all three, so no adapter change.
- Docs: `docs/configuration.md`, `docs/using-memory.md`, and a new ADR-034.
- Related: ADR-033 and TDR-054 (tag word matching).
