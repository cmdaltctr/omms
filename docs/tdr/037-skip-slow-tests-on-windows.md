# TDR-037: Skip slow tests on Windows

- **Date:** 2026-10-07
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** Windows, tests, CI, flaky tests

## Context

The Windows test job and the Windows package smoke in the release workflow run the whole suite. Release 4.13.0 stopped at the Windows smoke. `publish` was skipped and npm `latest` stayed at 4.12.0.

### Root Cause Analysis

Four tests hit the 30-second limit when a Windows runner stalls:

- `web-profile-catch-up`: two tests, on pull request runs and on `main`.
- `pi-importer`: the filter test (PR #102 run `37527918276`).
- `profile-catch-up-lease-cleanup`: the `user-prompt-learning-order` child (release run `37668844304`).

The stall is not in the code under test. In the 4.13.0 run, a child step that seeds 3 prompts and counts them took 25.5 seconds. The same step took 167 ms and 244 ms in two earlier Windows runs. The same code passed on rerun, passed in the release run for the previous merge, and passed on every other platform. Earlier notes name antivirus delay on database file writes and Bun recompiling sources in a fresh home folder as suspects. Neither is confirmed.

Other recent Windows failures were different: `nodeLockFs.replace`, the start lock, claim reclaim, and the two-process web start. They fail within 3 seconds, so they are race or lock failures, not slowness. They are not skipped.

## Decision

- Skip the four tests on Windows only, with `it.skipIf(SKIP_ON_SLOW_WINDOWS)`. `SKIP_ON_SLOW_WINDOWS` lives in `tests/test-process.ts`.
- In `profile-catch-up-lease-cleanup`, skip only the `user-prompt-learning-order` case. The `profile-catch-up-lease` case checks the same database client cleanup with four clients and keeps running.
- List the skipped tests in `docs/ci.md`.
- Keep every assertion, timeout, and production file unchanged. Keep the lock and race tests running on Windows.

## Consequences

The release smoke and the pull request job no longer fail on a stalled runner in these tests. Windows no longer checks profile catch-up pausing and takeover, or the Pi importer filters. The code those tests exercise has no `win32` branch, the catch-up lease is a database table, and macOS and Linux still run the tests. A real slowdown in them on Windows would go unseen.

## Alternatives Considered

- Raise the limits to 60 seconds for the test and 45 seconds for the child, as TDR-035 did. This keeps the coverage but a longer stall still fails. It was not chosen because a stall of 25 seconds in a 3-prompt step is not a limit problem.
- Drop the Windows test suite and keep an install check. This stops all Windows flakes but also stops path and lock coverage that has found real bugs.
- Rerun on failure. This works but blocks every release for about 15 minutes each time.
