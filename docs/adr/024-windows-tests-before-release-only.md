# ADR-024: Windows tests run before a release, not on pull requests

**Date:** 2026-10-07
**Status:** Proposed
**Deciders:** OMMS maintainer
**Supersedes in part:** [ADR-020](./020-pull-requests-test-on-windows.md), the Windows job on every pull request

## Context

ADR-020 added a Windows test job to every pull request. On 2026-10-07 that job failed on four pull requests and one release in a row. Each time a different test timed out: `web-profile-catch-up`, `pi-importer`, `profile-catch-up-lease-cleanup`, `web-step-aside`, `package-skills`, and `web-profiles-route`. Each passed on a rerun and in earlier runs, where it took 0.3 to 9 seconds. In the failed runs the same tests took 25 to 60 seconds or more.

The job runs on Windows Server 2025. GitHub reports that Defender real-time protection is already off on the Server images ([runner-images #14326](https://github.com/actions/runner-images/issues/14326)), so antivirus is an unlikely cause. The cause of the stalls is not known.

A failed Windows job also fails the Quality run. The release pull request merges itself only after a passing Quality run (ADR-023), so a stall also stopped the release pull request.

TDR-037 skipped four slow tests on Windows. Two more files failed the next day, so skipping files one at a time does not stop the failures.

## Decision

- Run `test-windows` on pushes to `main` only. Pull requests no longer run it.
- Keep Windows in the release smoke and the weekly smoke (`platform-smoke.yml`). Nothing reaches npm without a Windows run.
- In the Windows smoke, set `OMMS_TEST_RETRY=1`. `scripts/run-tests-isolated.sh` then runs each failed file once more. A file that fails twice fails the run. A file that passes on retry is named in the log and as a GitHub warning.
- Keep TDR-037's skips.

## Consequences

### Positive

- Pull requests and the release pull request no longer wait on, or fail from, a stalled Windows runner.
- A single stall no longer stops a release before npm.

### Negative

- A Windows-only break shows up after merge, in the `main` push run or the release smoke, not on the pull request that caused it.
- The retry can hide a test that is slow on Windows. The warning names it, so it stays visible.

### Neutral

- macOS and Linux coverage is unchanged.
- The `main` push run still reports Windows failures, but it gates nothing.
