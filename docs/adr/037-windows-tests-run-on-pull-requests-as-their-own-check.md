# ADR-037: Windows tests run on pull requests as their own check

**Date:** 2026-10-31
**Status:** Proposed
**Deciders:** OMMS maintainer
**Supersedes in part:** [ADR-024](./024-windows-tests-before-release-only.md), the rule that pull requests run no Windows tests. Windows still gates npm in the release smoke.

## Context

[ADR-024](./024-windows-tests-before-release-only.md) took Windows tests off pull requests. Stalls on the Windows runner had failed whole Quality runs, and a failed Quality run stops the release pull request from merging itself ([ADR-023](./023-automate-release-except-npm-approval.md)).

That left one Windows run before the release: the `test-windows` job on a push to `main`. The Quality workflow cancels a running push when the next push arrives (`cancel-in-progress: true`). Merges often land close together, so the Windows run is often cancelled before it ends.

This hid a Windows-only break. A test built a path with `URL.pathname`, which gives a wrong path on Windows. The pull request ran no Windows job. The `main` run that would have caught it was cancelled (run `41246057579`). The first Windows run to finish was the release smoke (run `41246451175`). It failed and blocked 4.33.0. PR #209 fixes the test.

- The repository is public, so hosted Windows runners cost no Actions minutes.
- Release auto-merge starts only when a run of the workflow named `Quality` completes. A different workflow cannot gate it.

## Decision

1. Add `.github/workflows/windows-pr.yml`. The workflow is named `Windows PR check`. It has one job, `test-windows-pr`, on `windows-latest`.
2. It runs on `pull_request` and skips docs-only pull requests with `paths-ignore` (`docs/**` and `**.md`). Quality's `changes` job applies the same rule. `paths-ignore` is safe here because nothing requires the check.
3. It runs the same steps as `test-windows` in Quality: Git Bash, build, and `scripts/run-tests-isolated.sh`. It sets `OMMS_TEST_RETRY=1`. A failed file runs once more. A file that passes on retry shows as a GitHub warning. A file that fails twice fails the job.
4. It is not a job in Quality, so a stalled Windows runner cannot fail a Quality run or stop the release pull request.
5. It is not a required check. Do not add it to the "Protect main" ruleset. The author reads its result before merging.
6. A new run on the same pull request cancels the older one. The job stops after 30 minutes.
7. Keep `test-windows` in Quality on pushes to `main`, and keep Windows in the release smoke and the weekly smoke.

## Consequences

### Positive

- A Windows-only break shows on the pull request that causes it, before the merge.
- A stall on the Windows runner does not stop the release pull request or the release.
- The retry keeps most one-off stalls from turning the check red.

### Negative

- The author waits about 7 minutes to see the full result. The merge itself does not wait.
- Nothing forces the author to read the result. A red check does not block a merge.
- A Windows run on the release pull request itself does not gate its auto-merge. The release smoke still gates npm.
- The retry can hide a test that is slow on Windows. The warning names it.
- Every pull request adds one Windows job.

### Neutral

- The `main` push run still reports Windows failures and can still be cancelled by the next push.
- The release smoke differs from this check. It runs `ci:local`, packs the package and installs it, on five platforms, and it gates npm.

## Alternatives Considered

| Option                                 | Rejected Because                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Windows inside Quality, as in ADR-020  | A stalled runner fails Quality and stops the release pull request from merging itself. This is why ADR-024 removed it.       |
| Make the `main` push run uncancellable | The Quality `concurrency` group cancels the whole run. Letting old runs finish makes pushes queue and delays `publish next`. |
| Do nothing                             | The 4.33.0 break repeats whenever the `main` run is cancelled. It costs a patch version.                                     |
| Make the new check required            | A stall on the Windows runner would block every merge. The ADR-024 failures were stalls of this kind.                        |

## References

- `.github/workflows/windows-pr.yml`, `.github/workflows/quality.yml`, `.github/workflows/release-auto-merge.yml`
- `scripts/run-tests-isolated.sh`
- [CI](../ci.md), [ADR-020](./020-pull-requests-test-on-windows.md), [ADR-023](./023-automate-release-except-npm-approval.md), [ADR-024](./024-windows-tests-before-release-only.md)
- Runs `41246451175` (release smoke) and `41246057579` (cancelled `main` run)
