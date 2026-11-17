# TDR-085: Editing a memory dropped its pin

**Date:** 2026-11-17
**Status:** Proposed
**Deciders:** OMMS maintainer
**Tags:** memory-edit, pinning, cleanup, turso

## Context

A code review reported that a pinned memory lost its pin after an edit. Automatic cleanup skips pinned memories, so an edited memory could be deleted later although the user had pinned it.

### Root Cause Analysis (if debugging-driven)

An edit swaps the row: it deletes the old row and inserts a new one in one transaction. Two paths did this, and neither wrote the `is_pinned` column, so the new row took the column default of 0.

1. The web page edit (`handleUpdateMemory` in `src/services/api-handlers.ts`) had its own insert SQL without `is_pinned`.
2. The client replace (`replaceMemoryRow` in `src/services/memory-replace.ts`) used `insertVectorInTransaction` in `src/services/turso/vector-writes.ts`. `MemoryRecord` had no pin field, so that insert could not write one. Only the `memorisation` snapshot replace (`replaceExisting`) uses this path today. Cleanup skips memorisations, so the effect there was a lost pin only.

The other writers that re-insert rows (space transfer, portability import, migration, legacy migrator) already set `is_pinned = 1` with a second statement after the insert.

The memories table has no other column that the edit lost. Access counts and links are not stored in it. `handleUpdateMemory` already carried `created_at`, `metadata` and the owner columns over.

## Decision

1. `MemoryRecord` gets an optional `isPinned`. `insertVectorInTransaction` writes it to `is_pinned` (absent means 0). Callers that set the pin afterwards are unchanged.
2. `replaceMemoryRow` reads the row it replaces and passes its pin to the insert.
3. `handleUpdateMemory` calls `insertVectorInTransaction` and passes the pin of the row it read. This removes its copy of the insert SQL.

Regression test: `tests/memory-edit-keeps-pin.test.ts`. It pins a memory in a temporary store, edits it through both paths and compares every stored column.

## Consequences

### Positive

- An edited pinned memory stays pinned and stays protected from cleanup.
- `handleUpdateMemory` has one insert path less to keep in step with the table.

### Negative

- None known.

### Neutral

- `replaceMemoryRow` still sets `created_at` and `metadata` from the new record. A snapshot replace is a new snapshot, so this is kept.

## Alternatives Considered

| Option                                              | Rejected Because                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Run `UPDATE memories SET is_pinned = 1` after edits | A second statement per path. The shared insert can write the column in the same step. |
| Add `is_pinned` to the SQL in `handleUpdateMemory`  | Keeps a second copy of the insert SQL, and the file size ceiling blocks growth.       |

## How to Recognise / Handle This Again

1. A memory that was pinned shows as unpinned after an edit.
2. Check that the path writes through `insertVectorInTransaction` with `isPinned` set from the row it replaces.
3. Run `bash scripts/run-tests-isolated.sh tests/memory-edit-keeps-pin.test.ts`.

## Revisit Triggers

- A new column is added to `memories`. Every path that rewrites a row must carry it.

## References

- `src/services/api-handlers.ts` (`handleUpdateMemory`)
- `src/services/memory-replace.ts`, `src/services/turso/vector-writes.ts`, `src/services/turso/types.ts`
- `src/services/cleanup-service.ts` (skips pinned rows)
- `tests/memory-edit-keeps-pin.test.ts`
