# TDR-063: Profile cold buffers followed a storage switch

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memory-spaces, user-profile, storage, reset

## Context

The change `add-memory-spaces` resets every store handle when the storage folder changes. `UserProfileManager.reset()` already existed for tests and for `closeTursoAndInvalidateCaches()`. The reset test for the profile store found that `reset()` did not clear everything.

### Root Cause Analysis

`UserProfileManager` loads the cold-start buffers (`cold-buffer.json`) once, in its constructor, and keeps them in memory. `reset()` pointed `dbPath` and `coldBufferPath` at the current folder, but kept the old `coldBuffers` map and the `dedupCheckedCache` set.

After a switch from space A to space B, the next save wrote space A's buffered preferences into space B's `cold-buffer.json`. Profile items from one space then leaked into another space's profile when the buffer drained.

Evidence: a test wrote a buffer in the Default space, switched to a new space and read `coldBuffers.size === 1` (expected 0).

## Decision

`reset()` now does all the work of the constructor, and the constructor calls `reset()`:

```ts
reset(): void {
  this.db = null;
  this.initPromise = null;
  this.dedupCheckedCache.clear();
  this.dbPath = join(CONFIG.storagePath || "", USER_PROFILES_DB_NAME);
  this.coldBufferPath = join(CONFIG.storagePath || "", "cold-buffer.json");
  this.coldBuffers = this.loadColdBuffers();
}
```

The file `user-profile-manager.ts` is over its size ceiling (1947 lines) and may not grow. The change adds no lines: the constructor shrinks by the same amount.

## Consequences

### Positive

- A space switch never carries cold-start buffers or dedup state into the next space.
- Switching back reloads that space's own buffer from disk.

### Negative

- `reset()` now reads `cold-buffer.json` from disk.

### Neutral

- Other callers of `reset()` also get fresh buffers. For them the buffers match what the file holds.

## Alternatives Considered

| Option                                        | Rejected Because                                   |
| --------------------------------------------- | -------------------------------------------------- |
| Clear the buffers in a memory-space-only hook | A second reset path would drift from `reset()`     |
| Key the buffers by storage folder             | Keeps data of a space the process no longer serves |
| Skip the buffer file and keep only the memory | Loses buffered items when the process stops        |

## How to Recognise / Handle This Again

1. Symptom: profile items from one space appear in another space after a switch.
2. Check `tests/space-switch.test.ts` ("does not carry profile cold buffers or dedup state into the next space").
3. A new in-memory cache that reads from `storagePath` must be reset in the same way. Register the owner with `resettable()` and clear the cache in its `reset()`.

## Revisit Triggers

- A new store object or cache that reads from `storagePath`.
- A change to how cold-start buffers persist.
