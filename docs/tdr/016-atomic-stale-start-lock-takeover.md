# TDR-016: Atomic takeover of a stale web start lock

**Date:** 2026-09-30
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-ensure, lock, concurrency

## Context

Every host calls `ensureWebApp` at session start. A start lock (`~/.omms/web-start.lock`) makes sure that only one caller starts the standalone web app. A lock is stale when its process is dead or it is older than 20 seconds. A stale lock must not block a later start.

### Root Cause Analysis

The old takeover read the stale lock, read it again, removed it, and created a new lock. Each step was a separate file operation. Two callers that saw the same stale lock could run in this order: A removes, A creates, B removes A's new lock, B creates. Both returned `true`, and both started a web app.

An injected file system test ran caller B in full before each file step of caller A. At A's remove step, both callers held the lock (`tests/web-ensure.test.ts`, "gives the lock to exactly one of two callers").

## Decision

A caller replaces a stale lock only after it hard-links the lock to a tombstone file. The tombstone name comes from a hash of the stale lock text.

1. Read the lock text and confirm it is stale.
2. Link the lock to `web-start.lock.<hash>.stale`. When the link fails because the tombstone exists, stop and wait.
3. Read the tombstone. When its text is not the stale text, the lock changed after step 1. Remove the tombstone and wait.
4. Remove the lock and create a new one with exclusive create.
5. Remove the tombstone.

A link never removes the lock, so a caller that loses never destroys another caller's lock. A tombstone older than 20 seconds (by its change time, which a link sets) comes from a crashed takeover. The next caller removes it and waits, and the caller after that does the takeover.

Code: `takeStartLock` in `src/services/web-ensure.ts`. `LockFs` has `link` and `ageMs`.

Restart writes the lock with `LockFs.replace` (write a temp file, then rename it over the lock). A reader never finds the lock missing between two writes.

## Consequences

### Positive

- Exactly one caller wins a stale lock. The injected test checks every interleaving of two callers.
- The lock file name and format are unchanged. `removeStartLockFor` and older versions still read it.

### Negative

- A file system without hard links cannot take over a stale lock. APFS, ext4, and NTFS support hard links.
- Two callers that remove the same old tombstone at the same moment can reopen the race once. This needs a crash inside a microsecond window first.

### Neutral

- A takeover leaves no tombstone behind after it finishes.

## Alternatives Considered

| Option                                              | Rejected Because                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Rename the stale lock to a unique name, then create | Rename acts on the path. A slow caller can rename the new lock away, and then both callers hold one.            |
| A separate takeover guard file                      | A crashed guard holder leaves a stale guard, and removing that guard has the same race.                         |
| Advisory file locks (`flock`)                       | Node has no built-in API, and Windows behaves differently.                                                      |
| Bind the port as the lock                           | The spawned child binds the port, not the caller, and the bind check races the child's own start (see ADR-014). |
