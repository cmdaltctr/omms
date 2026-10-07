# TDR-039: Publish complete cross-process write locks

- **Date:** 2026-10-07
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** storage, concurrency, release, filesystem

## Context

Release 4.13.2 failed on macOS 26 in `tests/two-process-storage.test.ts:258`.
All 50 memory rows survived, but shard metadata totalled 48 vectors. The other
five platforms passed. Publishing was skipped.

### Root Cause Analysis

`writeFileSync(path, payload, { flag: "wx" })` creates an empty file before
writing its process ID (PID). Another process can read that empty file.
`readLiveLock` then treats it as corrupt, deletes it, and acquires the lock.
The first process finishes writing through its open handle and also enters.
Overlapping writes can overwrite the reconciled shard count.

The regression test forces this interleaving through the real filesystem. It
observed two active writer callbacks on the old code, where one was expected.
The CI log does not record the exact filesystem interleaving.

## Decision

Write each complete payload to a unique temporary file in `.write-locks`.
Use `linkSync(candidate, path)` to publish it. The hard link creates the lock
without replacing an existing one. A contender sees a complete payload or no
lock. Keep the existing lock path, JSON fields, dead-owner recovery, and
15-second contention deadline.

Remove the temporary file in `finally`. Remove the lock only after acquisition.
Report publication errors other than `EEXIST` to the caller. On Windows, retry
`EPERM`, `EACCES`, and `EBUSY` with the bounded waits from TDR-034: 1, 2, 5, 10,
20, 50, 100, and 200 milliseconds. Persistent errors still fail.

## Consequences

### Positive

- A contender cannot reclaim a new lock while its payload is being written.
- Deterministic tests cover exclusivity, error cleanup, Windows retries, and dead-owner recovery.

### Negative

- The storage filesystem must support hard links, as APFS, ext4, and NTFS do.
- A process killed before cleanup can leave an unused temporary file.

### Neutral

- All hosts receive the fix through the shared storage code. Memory data stays unchanged.
- This change repairs publication. The existing stale-lock takeover logic stays unchanged.

## Alternatives Considered

| Option                                  | Rejected because                                          |
| --------------------------------------- | --------------------------------------------------------- |
| Retry the failed smoke test             | Leaves overlapping writers possible.                      |
| Rename a prepared payload over the lock | Can replace another process's live lock.                  |
| Delay before removing an empty lock     | Depends on how long the operating system pauses a writer. |

## How to Recognise / Handle This Again

1. Compare readable memory rows with the shard metadata counts.
2. Run `bash scripts/run-tests-isolated.sh tests/cross-process-write-lock.test.ts tests/two-process-storage.test.ts`.
3. Run `bun run ci:local` in the fix worktree before pushing.
4. Run the six-platform smoke on the fix branch before merging, with maintainer approval.

## Revisit Triggers

Reassess if counts still drift, stale-owner takeover permits overlapping writers,
or storage moves to a filesystem without hard links.

## References

- [Failed release run](https://github.com/cmdaltctr/omms/actions/runs/37684125173)
- [TDR-034: Windows hard-link retries](034-retry-windows-start-lock-hard-links.md)
- [Shared-store specification](../../openspec/specs/host-neutral-memory-core/spec.md)
- [Node filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html#fslinksyncexistingpath-newpath)
- `src/services/turso/cross-process-write-lock.ts`
- `tests/cross-process-write-lock.test.ts`
