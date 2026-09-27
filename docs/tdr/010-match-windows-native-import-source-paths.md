# TDR-010: Match Windows import-source tests to native canonical paths

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** Windows, tests, import

## Context

After the Windows trace ACL fix passed its focused tests, the package smoke check failed three assertions in `tests/import-sources.test.ts`. The source browser and validator passed their other tests.

### Root Cause Analysis

`src/importer/import-sources.ts` uses `realpathSync.native()` to pin source identity. On the GitHub Windows runner, `realpathSync()` returned a DOS short path such as `C:\Users\RUNNER~1`, while `realpathSync.native()` returned `C:\Users\runneradmin`. The tests compared the implementation's long path against the short path.

## Decision

Compare the source's displayed path, signed identity and browse parent with `realpathSync.native()` in the existing tests. Keep production path canonicalisation unchanged. Run all test cases, including symlink handling and source-replacement detection, on Windows and POSIX.

## Consequences

### Positive

- The tests check the same canonical identity that the import-source token stores.
- Windows path aliases no longer cause false failures.

### Negative

- The tests depend on Node's native canonical-path semantics across supported runtimes.

### Neutral

- No stored data, API response or source-validation behaviour changes.

## Alternatives Considered

| Option                             | Rejected Because                                              |
| ---------------------------------- | ------------------------------------------------------------- |
| Compare to `realpathSync()`        | It uses a different path form on the Windows runner.          |
| Normalise strings after comparison | It could hide a genuine change to the signed source identity. |
| Skip Windows tests                 | It would remove coverage of path and token safety on Windows. |

## How to Recognise / Handle This Again

1. Look for a Windows test mismatch between `RUNNER~1` and `runneradmin`.
2. Check whether the source uses `realpathSync.native()`.
3. Compare test expectations with the same native method, then rerun Windows package smoke.

## Revisit Triggers

- Node or Bun changes native real-path handling on Windows.

## References

- [Node.js file system documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)
- `src/importer/import-sources.ts`
- `tests/import-sources.test.ts`
