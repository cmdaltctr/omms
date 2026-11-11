# TDR-078: The OpenCode importer missed the V2 session tables

**Date:** 2026-11-11
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** import, opencode, ledger, sqlite

## Context

The OpenCode history importer read only the tables `session`, `message` and `part`. OpenCode 2.x writes new sessions to `session_v2` and `session_message`. The import command, the terminal import and automatic backfill skipped every session that lived only in the V2 tables. They gave no warning.

### Root Cause Analysis

Read-only checks on the maintainer's `opencode.db` on 10 November 2026:

| Check                                      | Result                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Rows: `session` / `session_v2`             | 1006 / 1199                                                                                                               |
| Rows: `message` / `session_message`        | 43125 / 50046                                                                                                             |
| Rows: `part` / `session_part`              | 194087 / 0                                                                                                                |
| V1 session ids also in `session_v2`        | 1006 of 1006                                                                                                              |
| `session_v2` ids not in `session`          | 193, created 27 September to 4 November 2026                                                                              |
| V1 user messages missing as V2 `user` rows | 338: 219 absent, 66 `synthetic`, 53 `compaction`. None of the 219 has a non-synthetic text part.                          |
| `session_message.type` values              | `assistant`, `user`, `synthetic`, `idle`, `system`, `compaction`, `agent-switched`, `model-switched`, `location-switched` |

1. OpenCode copied all 1006 V1 sessions into `session_v2` with the same ids.
2. OpenCode 2.x keeps message content inside `session_message.data` (JSON). `session_part` is empty.
3. The importer never read `session_v2`. The 193 newer sessions were invisible to it.

A second finding came from the import ledger (`import-ledger.db`):

- It holds 7356 OpenCode rows that are imported or skipped, in 400 sessions.
- All 400 session ids and all 7356 user message ids exist as V2 `user` rows.
- Only 2452 of the 7356 last-answer ids still exist, in either table set. The other 4904 are gone from both `message` and `session_message`.

The unit key was `opencode:<session>:<user message>:<last answer>`. A rerun could not match a key whose last-answer id no longer exists. The same weakness would repeat memories for those units.

## Decision

1. **Read the V2 tables first.** The importer lists `session_v2` rows, plus V1 `session` rows whose id has no `session_v2` row. A session comes from one table set only. A database with neither set fails with an error that names both sets of missing tables.
2. **Map V2 messages to work units.** A `user` message starts a unit. An `assistant` message adds its `text` items and its `tool` items. A `synthetic` or `compaction` message ends the unit. Other types are ignored. The builder is `src/importer/opencode-v2-units.ts`.
3. **Match OpenCode ledger rows by session id and user message id.** A unit counts as handled when the ledger has an imported or skipped row whose key starts with `opencode:<session>:<user message>:`. The lookup uses the `session_id` index (`src/importer/handled-lookup.ts`, `findHandledByPrefix` in `src/importer/ledger.ts`). Pi and Claude Code keep exact keys. A new memory still gets the full key, so crash reconciliation by import identity does not change.

Bug score for the ledger match: likelihood 7 (every rerun or backfill over this database), impact 5 (duplicate memories and profile prompts, recoverable by hand). Product 35, so the fix is in scope.

## Consequences

### Positive

- The import, the dry run and automatic backfill see the 193 V2-only sessions.
- A rerun does not import units from the V1 era again, even when their last answer was deleted.
- An older database copy that has only the V1 tables still imports.

### Negative

- A unit that gained new answers after its import counts as handled. OpenCode adds new turns as new user messages, so this is rare.
- The importer keeps two readers, one for each table set.
- Profile rows share the prefix (`…#profile`, `…#profile-rebuild`). The first version of the match counted them as imported memories, so a failed unit with a recorded profile prompt was never retried. The match now skips rows with `project_hash = 'profile'` (`tests/import-ledger.test.ts`).

### Neutral

- Live capture does not read this database. It reads messages through the plugin context.
- The 8 GB snapshot copy that the importer makes when a WAL exists does not change.

## Alternatives Considered

| Option                               | Rejected Because                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Read the V2 tables only              | An older copy passed with `--db` would fail. The union costs one `NOT EXISTS` clause.    |
| Keep exact-key matching for OpenCode | 4904 of 7356 ledger last-answer ids no longer exist, so reruns would repeat those units. |
| Rewrite the ledger keys in place     | It edits recorded history, and a failure part way leaves a mixed ledger.                 |
| Match by session id alone            | A session that gained new prompts would skip them.                                       |

## How to Recognise / Handle This Again

1. Symptom: a session that you can see in OpenCode is missing from the import or dry-run counts.
2. Check the tables, read-only: `sqlite3 -readonly ~/.local/share/opencode/opencode.db "SELECT COUNT(*) FROM session_v2 WHERE id NOT IN (SELECT id FROM session)"`.
3. A count above 0 on an older OMMS version confirms this finding. Upgrade OMMS and run the import again.
4. If a future OpenCode version renames the tables, the import stops with an error that names the missing tables. Update `src/importer/opencode-reader.ts`.

## Revisit Triggers

- OpenCode changes the layout of `session_v2` or `session_message`.
- OpenCode stops copying V1 sessions into `session_v2`, so the V1 fallback matters again.
- A unit that gained new answers after its import needs a fresh import.

## References

- [ADR-048](../adr/048-omms-supports-opencode-v2-only.md)
- [OpenCode history import](../opencode-history-import.md)
- `src/importer/opencode-reader.ts`, `src/importer/opencode-v2-units.ts`, `src/importer/handled-lookup.ts`, `src/importer/ledger.ts`
- [`drop-opencode-v1`](../../openspec/changes/drop-opencode-v1/design.md)
