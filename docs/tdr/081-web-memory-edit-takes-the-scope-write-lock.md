# TDR-081: Web memory edit takes the scope write lock

**Date:** 2026-11-16
**Status:** Proposed
**Deciders:** OMMS maintainer
**Tags:** storage, web, write-lock, concurrency

## Context

Every memory write takes `tursoShardManager.withScopeWriteLock` for the memory's scope. The lock is an in-process queue plus a cross-process file lock, so OpenCode, Pi, the Claude Code web app and an import do not write the same scope at the same time. The `modular-boundaries` audit found one write that skipped it: the web memory edit.

### Root Cause Analysis (if debugging-driven)

`handleUpdateMemory` in `src/services/api-handlers.ts` read the row, embedded the new text, then ran its own `DELETE` and `INSERT` in a transaction with no lock. `client.ts` `addMemory` and `handleAddMemory` take the lock. The edit had its own copy of the insert SQL, so it also did not follow later changes to `replaceMemoryRow`.

Bug score: likelihood 2 (a web edit while a capture or an import writes the same scope from another process) × impact 2 (a busy error or an out-of-order write on one row; the transaction stops a partial write) = 4. Fix now.

## Decision

`handleUpdateMemory` keeps its read and its embedding outside the lock, as `client.ts` does. It then builds a `MemoryRecord` from the existing row and the edit, and calls `replaceMemoryRow(record)` inside `withScopeWriteLock` for the scope in the row's container tag. The copied `DELETE` and `INSERT` SQL is gone. When `replaceMemoryRow` returns false (the row was deleted between the read and the lock), the edit returns "Memory not found" and inserts nothing.

## Consequences

### Positive

- The web edit waits for other writers of the same scope, in this process and in other processes.
- One replace path for the memory row (`src/services/memory-replace.ts`).

### Negative

- A row whose container tag does not have the `{prefix}_{user|project}_{16hex}` form cannot be edited. `extractScopeFromContainerTag` throws, and the edit returns the parse error. The old code edited that row. Every write path makes tags in that form, so only a malformed legacy row can meet this.
  - Proposed issue, not fixed: "Web edit refuses a row with a malformed legacy container tag". Likelihood 1, impact 3, score 3. Trigger: a row in the `memories` table whose container tag was written by hand or by a very old build, then edited in the web app.

### Neutral

- The response and the stored row are the same as before for an edit that does not race another write.

## Alternatives Considered

| Option                                   | Rejected Because                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Take the lock around the old SQL         | Keeps a second copy of the insert SQL next to `replaceMemoryRow`             |
| Embed inside the lock                    | Holds the scope lock during a slow model call and blocks every writer        |
| Take the lock for the read and the write | Same as above; the read needs no lock, and `replaceMemoryRow` checks the row |

## How to Recognise / Handle This Again

1. A write to the `memories` table runs without `withScopeWriteLock`.
2. Search for `db.transaction("write"` and `DELETE FROM memories` outside `src/services/turso/` and `memory-replace.ts`.
3. Move the write into `withScopeWriteLock` and reuse `replaceMemoryRow` or `insertVector`. Add a test that holds the lock and checks that the row does not change.

## Revisit Triggers

- The storage port moves memory writes behind one store. The lock then belongs to the store.
- A test for "every write takes the scope write lock" lands.

## References

- `src/services/api-handlers.ts` (`handleUpdateMemory`)
- `src/services/memory-replace.ts`
- `tests/web-update-write-lock.test.ts`
- OpenSpec change `modular-boundaries`, design decision 8
