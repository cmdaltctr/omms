# TDR-094: File locks misread a lock in transit

**Date:** 2026-11-23
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** locks, web-ensure, spaces, windows, release-smoke

## Context

Two file locks failed in CI in the same week. Both locks use a create-exclusive file. In both cases a caller saw the lock file in a short, normal state and treated it as wrong.

1. **Start lock** (`takeStartLock`, `src/services/web-ensure.ts`). The 7.3.1 release smoke on macOS 26 failed twice: `gives a stale start lock to exactly one of several processes that replace it at once` saw 2 winners.
2. **Spaces registry lock** (`acquireLock`, `src/services/spaces/registry-store.ts`). `test-windows-pr` on PR #305 failed `loses no update when separate processes write at once` (issue #307). A child process exited non-zero. A re-run passed.

### Root Cause Analysis

**Start lock.** `writeFileSync(path, text, { flag: "wx" })` creates the file, then writes the text. A second caller can read the file between those two steps and get an empty string. `lockIsStale` called any unreadable lock stale, so the second caller replaced a live lock that was still being written. The registry lock already had a 2 second grace for this case. The start lock did not.

**Registry lock.** On Windows, a file that one process deletes while another process still has it open stays "delete pending". Creating a file with that name then fails with `EPERM`, `EACCES` or `EBUSY`, not `EEXIST`. A waiting writer reads the lock in `lockIsStale`, so it can hold the file open when the holder deletes it. `acquireLock` threw on every code other than `EEXIST`, so the next writer crashed. The start lock already retries these codes (`tests/web-start-lock-link.test.ts`). The registry lock did not.

## Decision

1. `lockIsStale` in `web-ensure.ts` calls an unreadable lock stale only when the file is older than the lock's age limit: 20 seconds for the start lock, 6 minutes for the install lock.
2. `acquireLock` treats `EPERM`, `EACCES` and `EBUSY` as a busy lock. It waits and retries until its 5 second deadline, then throws `lock-timeout`. Other errors still throw at once.
3. The multi-process registry test prints a crashed child's error, so a future failure names its cause.

## Consequences

### Positive

- Exactly one caller holds each lock, on every platform.
- A corrupt lock left by a crash is still taken over, after the age limit.

### Negative

- A corrupt start lock blocks a start for up to 20 seconds. Before, the next caller replaced it at once.

### Neutral

- No change to the lock file format.

## Alternatives Considered

| Option                                        | Rejected Because                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| Write the lock to a temporary file, then link | A larger change to both locks for a gap that an age check closes.          |
| Retry the failing tests                       | It hides two real races. Both can start two writers on a user's machine.   |
| Treat every create error as busy              | A full disk or a missing folder would wait 5 seconds, then hide the cause. |

## How to Recognise / Handle This Again

1. A multi-process lock test sees 2 holders, or a child exits non-zero, on one platform only.
2. Check whether the losing caller read the lock while it was empty, or got `EPERM`/`EACCES`/`EBUSY` on create.
3. Look for a lock that does not use these two rules.

## Revisit Triggers

- A new create-exclusive lock is added. Give it both rules, or move the locks to one shared helper.

## References

- Issue #307
- `src/services/web-ensure.ts`, `src/services/spaces/registry-store.ts`
- `tests/web-ensure.test.ts`, `tests/spaces-registry-lock-windows.test.ts`, `tests/spaces-registry-store.test.ts`
- `tests/web-ensure-real-process.test.ts`
