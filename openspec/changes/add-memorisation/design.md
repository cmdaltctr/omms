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

`type` is indexed and already in every row, so `type != 'memorisation'` is a cheap SQL predicate. The tag puts the label into the FTS5 `tags` column and the tag-match boost, which helps recall-by-text rank memorisations. A new column or a separate table was considered. A column needs a migration across shards. A table needs its own export, import, transfer and space-reset paths. Both cost more for no user-visible gain.

### Kind filter defaults to hiding memorisations

Add a `kind` option to the shared search and list functions: `"normal"` (default) adds `AND type IS NOT 'memorisation'`; `"memorisation"` adds `AND type = 'memorisation'`. The predicate goes into the SQL of `searchKind`, the hydrate query, `searchKeywords`, `exact-scan`, `listMemories`, `getMemoriesBySessionID` and the linked-space readers. With "normal" as the default, per-prompt recall, opening context, compaction and resume restore, capture context, the web chat, `search`, `list` and the Memories page all hide memorisations with no edit at their call sites. Filtering after the query was rejected because the result limit applies first and would drop real matches.

Duplicate removal reads rows through its own query (`deduplication-service.ts:54`), retention cleanup through its own (`cleanup-service.ts:72-76`), and the AI tag backfill through its own (`api-handlers.ts:1279`). Each gets the same predicate directly. Memorisations always carry at least the `memorisation` tag, so the backfill would skip them anyway; the predicate makes that explicit.

### Short ID `mz-` plus six base-36 characters

Six characters give about 2.2 billion values. On insert, OMMS checks the ID is unused across shards and draws again on a clash, up to five tries. The ID is the row's primary key, so delete, export and transfer work unchanged. Recall treats any input matching `^mz-[a-z0-9]{6}$` as an ID lookup through `getMemoryById` across the active and linked spaces.

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

Recall by text runs the normal hybrid search (vector plus keyword, honouring `keywordMode` and the reranker) with `kind: "memorisation"`. The score shown is the existing similarity score as a percentage. One match is returned alone when it scores 80 or more and leads the next by 10 points or more; otherwise up to three, or up to `limit`. These two thresholds are constants in the recall module, not settings.

### Replace keeps the ID

With `memorisationRepeat: "replace"`, OMMS finds the latest snapshot whose `metadata.hostSessionId` matches (via `json_extract`, as `live-captured-entries.ts` already does), deletes it and inserts the new snapshot under the same ID. An ID the user already quoted keeps working. Explicit memorisations never replace.

### Session ID per host

- Pi passes `hostSessionId` to the tool today.
- OpenCode V2 delegates to the V1 executor in `src/index.ts`, which passes none today. The V2 tool context has the session ID; pass it through.
- Claude Code: the tool runs the CLI. Add a `--session-id` CLI flag. Task 1.1 checks whether the mod's `tool.call` context exposes the session ID. If it does not, Claude Code snapshots are always added and the reply says so, as the spec requires.

### Setting

`memorisationRepeat` joins `src/config.ts` as a global key (default `"add"`), the writer allowlist and validator, `settings-snapshot.ts`, and `config-template.ts`. It is not added to the project override list, so a project config cannot change it. New pure logic (ID format, snapshot text, recall pick) goes in `src/core/memorisation.ts` with `CONFIG` passed in, following `live-model-choice.ts`, so test stubs of `config.js` keep working.

### Skill and slash command

`skills/omms-remember/SKILL.md` ships beside `omms-memory` through the existing paths: the package `files` list, Pi's `"pi": {"skills": ["./skills"]}`, the Claude Code plugin root, and `package-skills.ts` for OpenCode. It is adapted from `s-handoff`: no handover file and no question rounds. It gathers git branch and head with read-only commands, writes the four fields from context, saves with `memorise` and reports the ID. It tells the user how to recall later.

### Web page

A new `memorisation` view in `routes.ts`, `MAIN_NAV` (after `project`), `App.tsx`, and a page component under 500 lines. New routes in `web-server.ts`: `GET /api/memorisations` (list) and `GET /api/memorisations/recall?q=` (recall). Delete reuses the existing memory delete route. The repeat choice saves through `PATCH /api/settings`.

## Risks / Trade-offs

- [A future read path forgets the filter] → The filter defaults to hiding memorisations, so a new caller is safe unless it asks for them. A test lists every SQL builder that reads `memories` and checks each one carries the predicate.
- [Linked spaces made before this change] → No migration is needed: older stores have no memorisations, and the predicate also matches rows whose `type` is NULL.
- [An agent ignores the size cap and stuffs a long transcript] → The cap is enforced in core, and the refusal names the limit, so the agent shortens and retries.
- [Claude Code cannot see the session ID] → Replace falls back to add, and the reply says so (task 1.1 settles this early).

## Migration Plan

No data migration. Rollback: an older OMMS version sees memorisations as ordinary memories of type `memorisation` and keeps them.
