# TDR-049: Category cleanup tests use the shared Windows cleanup

**Date:** 2026-10-15
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** Windows, libSQL, tests, release

## Context

The 4.17.0 release did not reach npm. The `Quality` run on `main` and the Windows package smoke both failed in `tests/category-cleanup-service.test.ts`. The test body passed. The `afterEach` hook failed with `EBUSY: resource busy or locked, rm` on the temporary folder. The `publish` job was skipped, so the tag `v4.17.0` and its GitHub release exist and npm has no 4.17.0.

### Root Cause Analysis

The four category-cleanup test files closed their database connections and then called `rmSync` once after a fixed 50 ms wait. libSQL keeps native file handles until garbage collection (see TDR-018). Windows refuses to remove a folder that holds a locked file. The pull request ran no Windows job, because `test-windows` runs only on pushes to `main` (ADR-024). The fault therefore showed only after the merge.

## Decision

Use `cleanupTursoTestDirectory` in the `afterEach` hook of all four files: `service`, `api`, `job` and `verdicts`. The helper closes managed connections, clears caches, collects released handles and retries Windows file locks. This is the fix TDR-018 prescribes.

Add `tests/category-cleanup-test-hygiene.test.ts`. It fails when one of the four files calls `rmSync` or does not call the helper. It runs on every platform, so a macOS run catches a new file that repeats the mistake.

## Consequences

### Positive

- The four files release their database before folder removal on Windows.
- The hygiene test turns this Windows-only fault into a failure on any platform.

### Negative

- The hygiene test checks source text. It guards the four named files only and does not simulate a lock.
- The fix is proven on Windows only when the Windows job runs on `main` after the merge.

## Alternatives Considered

| Option                             | Rejected Because                                                   |
| ---------------------------------- | ------------------------------------------------------------------ |
| Add a longer fixed wait            | The wait is a guess, and the lock can outlast it on a slow runner. |
| Re-run the failed Windows job      | The same test failed in two jobs, so a re-run would fail again.    |
| Run Windows on pull requests again | ADR-024 removed it because Windows stalls failed whole PR runs.    |

## How to Recognise / Handle This Again

1. Find `EBUSY` in the Windows smoke log, inside an `afterEach` hook.
2. Check that the file uses `cleanupTursoTestDirectory` and no bare `rmSync`.
3. Add the file to the hygiene test list.
4. Run `bun run ci:local`.

## References

- TDR-018: Close catch-up lease test databases before cleanup
- ADR-024: Windows tests run before a release, not on pull requests
