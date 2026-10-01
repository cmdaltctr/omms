# TDR-018: Close catch-up lease test databases before cleanup

- **Date:** 2026-10-01
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Windows, libSQL, tests, release

## Context

The 4.0.0 Release workflow passed on Linux and four macOS runners. Windows failed in the cleanup hook for `tests/profile-catch-up-lease.test.ts`. All four test cases passed, but npm staging was skipped.

### Root Cause Analysis

Each test opens a database through `tursoConnectionManager`. The manager keeps those connections open. The cleanup hook calls `rmSync` without closing them. Windows refuses to remove the locked folder and reports `EBUSY`.

## Decision

Use `cleanupTursoTestDirectory(dir)` in the lease test's `afterAll` hook. The existing helper closes managed connections, clears caches, and retries Windows file locks after garbage collection.

Add a child-process regression test that makes folder removal fail while a tracked database client remains open. Run it against the original cleanup hook first. This simulates the Windows restriction on every platform.

## Consequences

### Positive

- The lease tests release their database clients before folder removal.
- The regression catches an open-client cleanup failure on macOS too.

### Negative

- The regression starts a separate Bun test process.

### Neutral

- Production lease behaviour stays unchanged.
- The shared helper warns if a Windows lock remains after its retry budget.

## Alternatives Considered

| Option                    | Rejected Because                                        |
| ------------------------- | ------------------------------------------------------- |
| Add removal retries alone | The manager still holds the database clients open.      |
| Skip Windows cleanup      | The open clients remain and the failure loses coverage. |

## How to Recognise / Handle This Again

1. Find `EBUSY` in the Windows smoke log.
2. Check whether the cleanup hook closes managed database connections.
3. Use the shared Turso cleanup helper.
4. Run `bun run ci:local`.
5. Run Platform Package Smoke on the fix branch before merging.

## Revisit Triggers

- The database library changes how it releases native file handles.
- Lease tests stop using the shared connection manager.

## References

- [Failed 4.0.0 release run](https://github.com/cmdaltctr/omms/actions/runs/36834402025)
- `tests/profile-catch-up-lease.test.ts`
- `tests/profile-catch-up-lease-cleanup.test.ts`
- `tests/turso-test-utils.ts`
- `src/services/turso/sqlite-handle-release.ts`
