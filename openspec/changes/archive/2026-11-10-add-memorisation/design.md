# Design

## Context

See proposal.md for the motivation. Facts from the code that shape the approach:

- The `memories` table (`src/services/turso/shard-manager.ts:307-327`) has an indexed free-text `type` column, a comma-joined `tags` column and a JSON `metadata` column. It has no session column. The session ID lives in metadata as `sessionID` (auto capture) or `hostSessionId` (tool `add`).
- `is_pinned` already exists, but the web UI uses it for its own pin feature (`/api/memories/:id/pin`), so it cannot double as the marker.
- No search path filters by type today. The only predicate is `container_tag`. Vector search (`vector-search.ts` `searchKind`, the hydrate query), keyword search (`keyword-search.ts` `searchKeywords`), `exact-scan.ts`, `listMemories`, `getMemoriesBySessionID` and the linked-space readers (`linked-search.ts`) each build their own SQL.
- Every copy path (space export, import, transfer, re-embed, path and tag-prefix migrations) copies `type`, `tags` and `metadata` whole, so a marker in those columns survives them.
- AI cleanup, auto cleanup and confidence decay act on `user_profiles` only and never read `memories`.
- No code assumes a memory ID starts with `mem_`.

## Goals / Non-Goals

**Goals:**

- One marker that every read path can filter in SQL, so result limits apply after the filter.
- Existing callers hide memorisations with no change at each call site.
- Recall costs few tokens: the size cap bounds every record.

**Non-Goals:**

- Editing a memorisation. Delete and memorise again.
- Reading session transcripts or history files to build a snapshot.
- A model call to write or summarise a snapshot. The agent in the session writes it.
- Showing memorisations in the web memory chat.
- Fixing the stray American "Analyze Selected" label in the AI cleanup panel. That is a separate one-line fix.

## Decisions

### Marker: `type = "memorisation"` plus the tag `memorisation`

`type` is indexed and already in every row, so `type != 'memorisation'` is a cheap SQL predicate. The tag puts the label into the FTS5 `tags` column and the tag-match boost, which helps recall-by-text rank memorisations. Only `memorise` writes the kind: `add` refuses `type: "memorisation"` and points to `memorise`, so no other record carries it. A new column or a separate table was considered. A column needs a migration across shards. A table needs its own export, import, transfer and space-reset paths. Both cost more for no user-visible gain.

### Kind filter defaults to hiding memorisations

Add a `kind` option to the shared search and list functions: `"normal"` (default) adds `AND type IS NOT 'memorisation'`; `"memorisation"` adds `AND type = 'memorisation'`. The predicate goes into the SQL of `searchKind`, the hydrate query, `searchKeywords`, `exact-scan`, `listMemories`, `getMemoriesBySessionID` and the linked-space readers. With "normal" as the default, per-prompt recall, opening context, compaction and resume restore, capture context, the web chat, `search`, `list` and the Memories page all hide memorisations with no edit at their call sites. Filtering after the query was rejected because the result limit applies first and would drop real matches.

Duplicate removal reads rows through its own query (`deduplication-service.ts:54`), retention cleanup through its own (`cleanup-service.ts:72-76`), and the AI tag backfill through its own (`api-handlers.ts:1279`). Each gets the same predicate directly. Memorisations always carry at least the `memorisation` tag, so the backfill would skip them anyway; the predicate makes that explicit.

### Capture skips a memorise turn

The kind filter hides stored memorisations, but the turn that saved one would still be captured as an ordinary memory ("Snapshot saved as ms-ke8zw6: canary deployed, next step is widening the rollout") and reach the agent through per-prompt recall. `captureConversation` therefore skips any turn whose tool calls include a successful `memorise` or `memorize` call, before the capture model runs. Each host reader sets `memorise` on the tool call from its raw arguments and its result (`src/core/memorise-turn.ts`); the reader cannot rely on the bounded input text, because the model chooses the key order and the 100-character cut can drop `mode`. A call counts as saved when the host reports no error and the reply does not say `success: false`, since the memory tool reports its own refusals as a normal reply. The Claude Code tool name `mcp__omms__memory` and a Bash `om-memory-system memory memorise` call both count. The skip shows in the capture attempt log as the reason `memorisation-turn`. The history import goes through the same function, so it skips these turns too. OpenCode V2 names the tool part `name` and keeps the reply in `state.content`, so the live reader reads both the V1 and the V2 shape.

### Short ID `ms-` plus six base-36 characters

Six characters give about 2.2 billion values. On insert, OMMS checks the ID is unused across shards and draws again on a clash, up to five tries. The ID is the row's primary key, so delete, export and transfer work unchanged. Recall treats any input matching `^ms-[a-z0-9]{6}$` as an ID lookup through `getMemoryById` across the active and linked spaces.

### Snapshot format

The stored text is plain Markdown so it reads well when recalled and in the web page:

```text
Topic: <topic>
Done: <done>
Doing: <doing>
Next: <next>
```

Empty fields are left out. Metadata holds `memorisation: "snapshot" | "explicit"`, `hostSessionId` when known, and `host`. The size cap applies to the stored text after `<private>` removal.

### Size cap in characters or tokens

Two global keys: `memorisationMaxSize` (default 2000) and `memorisationSizeUnit` (`characters` or `tokens`, default `characters`). Tokens reuse `estimateTokens` from `src/core/context-budget.ts` (UTF-8 bytes divided by 4), the same estimate as `retrievalMaxTokens`. A real tokenizer was rejected: it depends on the host model, which Claude Code and the CLI do not know, and adds a dependency. The range is 100 to 20,000 characters or 25 to 5,000 tokens (the same bytes either way). The validator in `global-config-writer.ts` checks the pair together, so a unit switch with an out-of-range number is refused. Lowering the cap never touches stored records.

### Recall ranking

Recall by text runs the normal hybrid search (vector plus keyword, honouring `keywordMode` and the reranker) with `kind: "memorisation"`. The score shown is the content similarity as a percentage, with no tag score blended in (see "Recall scores content only"). One match is returned alone when it scores 80 or more and leads the next by 10 points or more; otherwise three by default, or up to the caller's `limit` when one is given (above or below three). These two thresholds are constants in the recall module, not settings.

### Recall scores content only

Normal search blends the content score (60%) with a tags score (40%). Every memorisation carries the same `memorisation` tag, so the tags half is almost the same for every record. Blending it pulls every score towards one value and flattens the spread, which the 80-point and 10-point-lead rules in "Recall ranking" depend on. Measured: a near-exact query scored 76 with the blend and 98 on content only. The scoring in `src/services/turso/vector-search.ts` therefore uses the content score alone when `kind` is `memorisation`. Normal searches keep the blend.

### Recall skips the ANN index

The ANN index (`vector_top_k`) covers every row and the kind filter runs after it. The candidate count is at least 128 (`max(limit * 16, 128)`). Ordinary memories close to the query can fill all of those candidates and hide the few memorisations behind them. A memorisation search therefore skips the index and scans directly in SQL (`exactScanKind` in `src/services/turso/exact-scan.ts`), with the kind and project filters in the `WHERE` clause. This is exact and cheap because memorisations are few: the user saves each one on purpose and each is size-capped. Normal searches keep the index.

### Replace keeps the ID

With `memorisationRepeat: "replace"`, OMMS finds the latest snapshot whose `metadata.hostSessionId` matches (via `json_extract`, as `live-captured-entries.ts` already does), deletes it and inserts the new snapshot under the same ID. An ID the user already quoted keeps working. Explicit memorisations never replace.

### Session ID per host

- Pi passes `hostSessionId` to the tool today.
- OpenCode V2 exposes `toolContext.sessionID` (`node_modules/@opencode-ai/plugin/dist/tool.d.ts:2-5`, plugin 1.18.25). `src/v2/adapter.ts:237-242` already forwards it to the V1 tool. The V1 executor in `src/index.ts` will accept that second argument and map `sessionID` to `MemoryOperationContext.hostSessionId`.
- Claude Code exposes the current session ID through `await $.session.id()`. The installed API declaration (`~/.claude/plugins/marketplaces/claude-code-plugins/mods/types/claude-code.d.ts:2378-2382`) says this returns the transcript file's name. The installed 2.1.322 runtime permits the `session.id` engine operation. The `tool.call` event has only `tool_use_id` and the optional `agentId`; neither is the session ID. The mod will pass this value to the CLI with `--session-id`.

### Setting

`memorisationRepeat` joins `src/config.ts` as a global key (default `"add"`), the writer allowlist and validator, `settings-snapshot.ts`, and `config-template.ts`. It is not added to the project override list, so a project config cannot change it. New pure logic (ID format, snapshot text, recall pick) goes in `src/core/memorisation.ts` with `CONFIG` passed in, following `live-model-choice.ts`, so test stubs of `config.js` keep working.

### Skill and slash command

`skills/omms-remember/SKILL.md` ships beside `omms-memory` through the existing paths: the package `files` list, Pi's `"pi": {"skills": ["./skills"]}`, the Claude Code plugin root, and `package-skills.ts` for OpenCode. It is adapted from `s-handoff`: no handover file and no question rounds. It gathers git branch and head with read-only commands, writes the four fields from context, saves with `memorise` and reports the ID. It tells the user how to recall later.

### Web page

A new `memorisation` view in `routes.ts`, `MAIN_NAV` (after `profile`), `App.tsx`, and a page component under 500 lines. New routes in `src/services/memorisation-routes.ts`, registered in `src/services/web-route-modules.ts`: `GET /api/memorisations` (list) and `GET /api/memorisations/recall?q=` (recall). The route registration builds the CONFIG values recall needs and passes them in, so the route module does not import CONFIG. Delete reuses the existing memory delete route. The repeat choice saves through `PATCH /api/settings`.

### Labels and bulk delete: API contract

Labels are the record's tags without the fixed tag `memorisation`. `parseTagList`, `visibleTags` and `hasAllTags` in `src/core/memorisation.ts` trim, lower-case and compare them, so the tool, the CLI and the web routes agree. Four endpoints make up the contract. Memorisation text never goes to the log.

| Call                                            | Reply                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/memorisations?tags=a,b`               | `{ memorisations: [{ id, content, createdAt, host, kind, space, tags }] }`. Records that carry every tag, newest first, capped at 200 after the filter. `space` is set for a linked space. |
| `GET /api/memorisations/recall?q=&tags=&limit=` | `{ count, matches }`. 400 when `q` and `tags` are both empty, 404 for an unknown `ms-` ID.                                                                                                 |
| `POST /api/memorisations/bulk-delete` `{ ids }` | `{ deleted: string[], skipped: { id, reason }[] }`. 400 unless `ids` holds 1 to 500 `ms-` IDs.                                                                                             |
| `recall` with `tags` (tool and CLI `--tags`)    | The same matches as the route. An exact ID ignores `tags`.                                                                                                                                 |

`reason` is `not-found`, `linked` or `not-memorisation`. Bulk delete runs `deleteMemorisation` per ID against the active space and this project's container tag, so a linked row is reported and never touched, and the general `/api/memories` delete routes keep refusing memorisations. The 500 limit counts IDs as sent, before repeats are removed.

Recall with `tags` and no text lists the newest labelled records through `listMemorisationsByTags`, which filters before it applies `limit` (default 10). Recall with text and `tags` reads up to 200 hits, keeps those that carry every label, then applies the usual one-strong-match rule.

The web page holds the label filter in `?labels=a,b`, written with `history.replaceState`. `label:X` in the recall box is parsed in `web/src/lib/memorisation-query.ts` and sent as `tags`. Select mode lives in `useMemorisationSelection`. It ticks only records without `space`, and it drops ticks for records that leave the list.

## Risks / Trade-offs

- [A future read path forgets the filter] → The filter defaults to hiding memorisations, so a new caller is safe unless it asks for them. A test lists every SQL builder that reads `memories` and checks each one carries the predicate.
- [Linked spaces made before this change] → No migration is needed: older stores have no memorisations, and the predicate also matches rows whose `type` is NULL.
- [An agent ignores the size cap and stuffs a long transcript] → The cap is enforced in core, and the refusal names the limit, so the agent shortens and retries.
- [Claude Code cannot see the session ID] → Replace falls back to add, and the reply says so (task 1.1 settles this early).

## Migration Plan

No data migration. Rollback: an older OMMS version sees memorisations as ordinary memories of type `memorisation` and keeps them.
