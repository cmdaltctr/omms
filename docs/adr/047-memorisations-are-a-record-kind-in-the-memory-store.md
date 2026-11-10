# ADR-047: Memorisations are a record kind in the memory store

- **Date:** 2026-11-10
- **Status:** Proposed
- **Deciders:** Aizat Hawari
- **Change:** [`add-memorisation`](../../openspec/changes/add-memorisation/proposal.md)

## Context

Agents lose track of where work stopped between sessions. The only way to keep a note was `memory add`. That note joins the general store and ranks by fuzzy search. Duplicate removal can delete it. It shows up in automatic recall whether the user wants it or not.

Users need a small, exact record. They save it on purpose and fetch it on purpose: "what were we going to do with xyz", or "recall ms-4k7q2p". The record must stay out of every automatic path, and it must work the same on OpenCode, Pi, Claude Code and the CLI.

Facts from the code that shape the decision:

- The `memories` table has an indexed `type` column, a comma-joined `tags` column and a JSON `metadata` column. It has no session column.
- Every copy path (space export, import, transfer, re-embed, path and tag-prefix migrations) copies `type`, `tags` and `metadata` whole.
- Each read path builds its own SQL: vector search, keyword search, the exact scan, `listMemories`, `getMemoriesBySessionID` and the linked-space readers.
- Vector search uses an ANN index (`vector_top_k`) that returns at most `max(limit * 16, 128)` candidates before any `WHERE` filter runs.

## Decision

1. **A memorisation is a row in the same store, marked `type = 'memorisation'`.** It also carries the tag `memorisation`, which feeds the keyword column. Only `memorise` writes the kind. `add` refuses `type: "memorisation"` and points to `memorise`.
2. **The kind filter lives in SQL, and "normal" is the default for every reader.** `src/services/memory-kind.ts` holds the predicate (`type IS NOT 'memorisation'`, which also keeps rows with a NULL type). Each read path puts it in its own query, before the result limit. A guard test (`tests/memorisation-kind-filter-guard.test.ts`) scans all SQL that reads `memories` and fails when a builder lacks the predicate. A new caller is safe unless it asks for memorisations.
3. **The ID is `ms-` plus six base-36 characters.** It is short enough to quote in a prompt. On insert, OMMS checks the ID is free across all shards, active and linked, and draws again on a clash, up to five tries. It is the row's primary key, so delete, export and transfer work unchanged. The full memory ID format (`mem_` plus a timestamp and random part) is too long to speak or type.
4. **Memorisations stay out of every automatic path.** Per-prompt recall, opening context, compaction and resume restore, capture context, the web memory chat and the Memories page never read them. Maintenance never touches them: duplicate removal, retention cleanup and the AI tag backfill carry the same predicate. Export is kind-neutral and still includes memorisations, so a backup or a transfer keeps them.
5. **Recall by ID is exact and limited to the current project.** An ID matching `^ms-[a-z0-9]{6}$` is looked up across the active space and the linked spaces. A row of another project is "not found". An exact ID ignores `tags`.
6. **Recall by text covers memorisations only and gives a confidence score.** It uses content-only scoring and an exact scan instead of the ANN index (decision 7 and decision 8). One match is returned alone when it scores 80 or more and leads the next by 10 points or more. Otherwise three are returned by default, or up to the caller's `limit`.
7. **Content-only scoring.** Normal search blends content (60%) and tags (40%). Every memorisation carries the same tag, so the tags half is almost constant and flattens the spread. A near-exact query scored 76 with the blend and 98 on content alone. The 80 and 10-point rules in decision 6 need the spread, so a search with `kind = "memorisation"` uses the content score only. Normal searches keep the blend.
8. **An exact scan replaces the ANN index for memorisations.** The index covers every row and the kind filter runs after it, so 128 or more closer normal rows hide the memorisations behind them. `exactScanKind` filters by kind and project in the `WHERE` clause. This is cheap because memorisations are few: the user saves each one on purpose and each is size-capped. See [TDR-073](../tdr/073-text-recall-missed-memorisations-behind-the-ann-candidates.md) and [TDR-074](../tdr/074-memorisation-confidence-scores-were-flattened.md).
9. **`memorisationRepeat` is `add` or `replace`, default `add`.** With `replace`, OMMS finds the latest snapshot whose `metadata.hostSessionId` matches, then swaps it for the new snapshot under the same ID. The delete and the insert run in one transaction in the shard that holds the row (`src/services/memory-replace.ts`), so a failed insert keeps the old row. An ID the user already quoted keeps working. Explicit memorisations never replace. With no session ID, replace falls back to add and says so.
10. **The size cap and its unit are a validated pair.** `memorisationMaxSize` (default 2000) and `memorisationSizeUnit` (`characters` or `tokens`, default `characters`) have different ranges: 100 to 20,000 characters, 25 to 5,000 tokens. The writer checks both together, so a unit switch cannot leave an out-of-range number. Tokens reuse `estimateTokens` (UTF-8 bytes divided by 4). Lowering the cap never touches stored records. All three settings (the two above and `memorisationRepeat`) are global-only: a project config cannot change them.
11. **User labels are kept and lower-cased.** The labels a user names when memorising are stored beside the fixed `memorisation` tag, trimmed, in lower case and without repeats. Pages show labels without the fixed tag. `recall` takes `tags` and returns records that carry every label.
12. **Bulk delete works on the active space only, through its own route.** `POST /api/memorisations/bulk-delete` takes 1 to 500 IDs. It deletes only rows of the current project in the active space. A linked row is reported as `linked` and never touched. The general `/api/memories` delete routes refuse memorisations, so this route owns the job.
13. **The host session ID comes from each host's own API.** Claude Code: `await $.session.id()`, passed to the CLI with `--session-id`. OpenCode V2: `toolContext.sessionID`, forwarded by `src/v2/adapter.ts` to the V1 executor. Pi: `ctx.sessionManager.getSessionId()`. The ID goes in `metadata.hostSessionId` and drives `replace`.
14. **OpenCode support is V2 only.** The change adds no feature to the V1 hooks. `AGENTS.md` now says OMMS supports OpenCode V2 only. The V1 tool executor in `src/index.ts` stays because V2 wraps it, so a change there is a V2 change.
15. **Capture skips a turn that saved a memorisation.** The kind filter hides stored memorisations, but capturing the turn that saved one would write the snapshot back as an ordinary memory and into per-prompt recall. `captureConversation` skips a turn when a `memorise` or `memorize` call succeeded, on every host and in the history import, and logs the reason `memorisation-turn`. A failed call does not skip. The detector is one shared function (`src/core/memorise-turn.ts`) fed by each host reader from the raw call arguments and the reply.

## Alternatives Considered

| Option                                                  | Rejected Because                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A separate database for memorisations                   | It needs its own export, import, transfer, backup and space-reset paths, and its own store-handle registration. No user-visible gain.          |
| A tag only, with no `type` marker                       | A tag lives in a comma-joined column, so SQL cannot filter it as cheaply as the indexed `type` column.                                         |
| A new column on `memories`                              | It needs a migration across every shard and every copy path.                                                                                   |
| Filter the kind after the query                         | The result limit applies first and would drop real matches.                                                                                    |
| Full memory IDs (`mem_` plus timestamp and random part) | Too long to quote in a prompt or to type.                                                                                                      |
| Keep the tags half in the recall score                  | The score collapses towards one value, and the 80-point and 10-point-lead rules stop working.                                                  |
| Raise the ANN candidate count for memorisations         | Any fixed count can still be filled by closer normal rows. An exact scan has no such limit.                                                    |
| Replace as a separate delete then insert                | A failed insert after the delete would lose the old snapshot.                                                                                  |
| A real tokenizer for the size cap                       | It depends on the host model, which Claude Code and the CLI do not know, and it adds a dependency.                                             |
| Let a project config set the three settings             | One project could change the cap or the repeat rule for the user's other projects. The settings are global-only, like the other shared limits. |
| Reuse the general bulk delete for memorisations         | Its routes refuse memorisations on purpose, so a normal delete cannot remove one by mistake.                                                   |
| Add the feature to OpenCode V1 as well                  | V1 is not supported. V2 wraps the V1 tool executor, so one change reaches V2.                                                                  |

## Consequences

### Positive

- A user saves a note once and gets the same text back, by ID or by a close description.
- No automatic path can show, merge or delete a memorisation by accident.
- No schema migration: an older store has no memorisations, and an older OMMS version sees them as ordinary memories of type `memorisation`.
- Recall scores spread across the full range, so one strong match is returned alone.

### Negative

- Every read path that touches `memories` must carry the kind predicate. The guard test is the only protection against a future builder that forgets it.
- The exact scan reads every memorisation vector of the project on each text recall. This is acceptable while memorisations stay few. A project with thousands would pay for it.
- Recall reads the current project only. A note saved in another project is not reachable from this one.

### Neutral

- Export and transfer carry memorisations with no extra code.
- The delete route and the general delete route stay separate by design.
- A memorisation cannot be edited. The user deletes it or memorises again.

## References

- [TDR-073](../tdr/073-text-recall-missed-memorisations-behind-the-ann-candidates.md)
- [TDR-074](../tdr/074-memorisation-confidence-scores-were-flattened.md)
- [TDR-075](../tdr/075-claude-code-live-checks-ran-the-global-cli-copy.md)
- [TDR-076](../tdr/076-memory-replace-imported-the-vector-writes-module-directly.md)
- [Using memory: Memorise and recall](../using-memory.md#memorise-and-recall)
- [Configuration: Memorisation](../configuration.md#memorisation)
- [Web UI: Memorisation page](../web-ui-memory.md#memorisation-page)
- `src/services/memory-kind.ts`, `src/core/memorisation.ts`, `src/services/memorisation-store.ts`, `src/services/memory-replace.ts`, `src/services/memorisation-routes.ts`, `src/services/turso/vector-search.ts`, `src/services/turso/exact-scan.ts`
- `src/core/memorise-turn.ts`, `src/core/capture.ts`
- `tests/memorisation-kind-filter-guard.test.ts`, `tests/memorisation-export-kind.test.ts`, `tests/memorisation-capture-skip.test.ts`
