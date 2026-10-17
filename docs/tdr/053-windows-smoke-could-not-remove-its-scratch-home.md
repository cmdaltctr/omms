# TDR-053: The Windows package smoke could not remove its scratch home

**Date:** 2026-10-17
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** release, windows, smoke, ci, sqlite

## Context

The release run for 4.21.0 (run 39052519138) failed on the Windows package smoke and skipped `publish`. npm stayed on 4.20.0. All source tests, the native dependency check and the libSQL vector check passed.

### Root Cause Analysis

The last step of `scripts/smoke-test.mjs` removes its scratch home folder with `rmSync`. On Windows it threw `EPERM` for that folder.

The most likely cause is an open database file:

- PR #150 made the web app delete old restore records of the automatic cleanup when it starts. That opens `user-profiles.db` in the scratch home.
- `WebServer.stop()` does not close the shared database connections. Windows refuses to delete a folder that holds an open file.
- The Windows smoke passed on 4.20.0 and 4.20.1, which were built before that start-up call, and failed on the first release that had it.

I could not run Windows, so the link is likely and not proven.

## Decision

The smoke script removes its scratch folder with `removeScratchDir` (`scripts/remove-scratch-dir.mjs`). It retries 10 times at 100 ms. On Windows it then leaves the folder when the error is `EPERM` or `EBUSY`. It throws any other error, and any error on another platform. The runner is throwaway, so a leftover folder does no harm, and the script ends with `process.exit(0)` right after.

The workflow copies the helper next to the script, because the smoke folder gets each script by itself. A test fails if the script imports a file that the workflow does not copy.

This is the same rule as `066dbf4`, which did the same for the real-process test home.

## Consequences

### Positive

- The Windows smoke no longer fails on a folder that a database file holds open.
- A new helper import in the smoke script cannot be forgotten in the workflow, because a test checks it.

### Negative

- A real leak of an open file in the web app would no longer fail the smoke. The unit tests of the stores cover closing connections.

### Neutral

- Web app stop still leaves the shared database connections open. That is unchanged.

## How to Recognise / Handle This Again

1. A release run fails on `smoke / windows-latest` in the step "Pack and install published package shape", and the log shows `EPERM` or `EBUSY` from `rmSync`.
2. Check whether a change since the last good release opens a database file when the web app starts.
3. Do not rerun the job and hope. The failure follows the code, not the runner.

## Revisit Triggers

- `WebServer.stop()` starts to close the shared database connections.
- The smoke script starts to check for leaked file handles on purpose.

## References

- [TDR-052](052-item-matching-breaks-when-a-save-rewrites-a-category-spelling.md), [ADR-030](../adr/030-profile-cleanup-runs-on-every-host.md)
- `scripts/remove-scratch-dir.mjs`, `tests/smoke-scratch-cleanup.test.ts`, `.github/workflows/platform-smoke.yml`
