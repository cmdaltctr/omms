# TDR-034: Retry Windows start-lock hard links

- **Date:** 2026-10-05
- **Status:** Accepted
- **Deciders:** OMMS maintainers
- **Tags:** windows, web-ensure, lock, concurrency

## Context

PR #95's Windows check failed while six processes tried to reclaim a stale web-start lock. One child exited with `EPERM` from `fs.linkSync`. The memory-control suites passed.

### Root Cause Analysis

`nodeLockFs.link` treated `EEXIST` and `ENOENT` as a lost claim, but threw every other error immediately. Windows rejected one hard-link operation during the concurrent takeover. The log establishes the refused operation; it does not establish which Windows resource caused it.

The existing rename path already retries Windows busy errors. A hard-link refusal prevented the same start-lock protocol from completing.

## Decision

Retry `EPERM`, `EACCES`, and `EBUSY` from `nodeLockFs.link` only on Windows. Use the rename path's existing waits: 1, 2, 5, 10, 20, 50, 100, and 200 milliseconds. Both operations share the named retry policy.

Keep `EEXIST` and `ENOENT` as immediate lost claims, including after a retry. Throw unrelated errors immediately. Throw persistent busy errors after nine attempts and 388 milliseconds of requested waits.

Keep the hashed hard-link claim and the subsequent content check from TDR-016. A caller that waits can encounter another caller's live lock; the content check must prevent it from removing that lock.

## Consequences

### Positive

- Temporary Windows refusals can clear without ending the caller.
- Deterministic tests cover the actual file adapter and a takeover during a wait.

### Negative

- A persistent Windows busy error can delay startup by 388 milliseconds, plus operation time.

### Neutral

- Lock names, formats, stale thresholds, and non-Windows behaviour remain unchanged.
- Permanent permission failures still reach the caller.

## Alternatives Considered

| Option                                       | Rejected Because                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Treat every permission error as a lost claim | Hides permanent permission failures and cannot recover a lone stale-lock contender. |
| Remove the lock without claiming it          | Can remove a different caller's new lock and permit duplicate starts.               |
| Retry the CI test until it passes            | Leaves the production error path unchanged.                                         |

## How to Recognise / Handle This Again

1. Inspect the failed `test-windows` job for `EPERM` from `linkSync`.
2. Run `bun test tests/web-start-lock-link.test.ts` for deterministic retry checks.
3. Build, then run `bun test tests/web-ensure-real-process.test.ts` with Node 24 on PATH.
4. Run `bun run ci:local` before pushing the fix.
5. Check the fresh Windows job for the six-process takeover result.

## Revisit Triggers

Reassess if Windows reports a different busy code, persistent permission failures, or more than one lock winner.

## References

- [Failed Windows job](https://github.com/cmdaltctr/omms/actions/runs/37275894911/job/111652739780)
- [PR #95](https://github.com/cmdaltctr/omms/pull/95)
- [TDR-016](016-atomic-stale-start-lock-takeover.md)
- [Node 24 `fs.linkSync`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fslinksyncexistingpath-newpath)
- `src/services/web-ensure.ts`
- `tests/web-start-lock-link.test.ts`
