# ADR-020: Pull requests run the test suite on Windows

**Date:** 2026-10-03
**Status:** Proposed
**Deciders:** OMMS maintainers
**Supersedes in part:** [ADR-001](./001-local-macos-and-github-ci.md), the decision not to run routine Windows checks

## Context

[ADR-001](./001-local-macos-and-github-ci.md) kept routine checks on macOS and ran Windows only in the release and weekly smoke. It named the risk: Windows regressions can go undetected.

That happened in 4.4.0. Tests added after 4.3.3 assumed POSIX behaviour: Linux-style install folders, `/` separators, a shell-script `npx`, and a symlink on `PATH`. They passed on macOS in pull request CI and failed in the Windows release smoke, so `publish` was skipped and the version was lost. The test runner also stopped at the first failing file, so it took five smoke runs to find every failure. See [TDR-026](../tdr/026-windows-test-failures-reached-the-release.md).

- The repository is public, so hosted Windows runners cost no Actions minutes.
- The full suite takes about 7 minutes on Windows and about 3 on macOS. The jobs run in parallel.
- The "Protect main" ruleset requires the `check` and `test` checks by name.

## Decision

1. The Quality workflow gets a `test-windows` job on `windows-latest`. It runs the same build and suite as `test`, under the same docs-only rule.
2. It is a separate job, not a matrix entry. A matrix renames `test` to `test (macos-latest)`, so the required check would never report and every pull request would stay blocked.
3. Every step runs in Git Bash, as the Windows release smoke does. The build calls `rm` and `chmod`.
4. `test-windows` is not a required check at first. A failure shows on the pull request without blocking the merge. The maintainer adds it to the ruleset once it runs reliably.
5. `scripts/run-tests-isolated.sh` runs every file and lists all failures, so one run shows every Windows failure.

## Consequences

### Positive

- Windows-only test failures show on the pull request that causes them, not at release time.
- A failed release no longer costs a patch version for a test-only problem.

### Negative

- Pull requests go green in about 7 minutes instead of 3.
- Until `test-windows` is required, a red Windows job does not block a merge. The author must look at it.
- `tests/web-ensure-real-process.test.ts` failed once on Windows with a start-lock race. If it fails again, it will make pull requests red at random.

### Neutral

- The release and weekly six-platform smoke stay as they are. They still cover Intel macOS, macOS 26, and the packed install.

## Alternatives Considered

| Option                                      | Rejected Because                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Turn `test` into a macOS and Windows matrix | Renames the required check and blocks every pull request.                  |
| Keep Windows in the release smoke only      | Failures show at release time and cost a version, as in 4.4.0.             |
| Run Windows only when some paths change     | The 4.4.0 failures came from tests across unrelated areas.                 |
| Make `test-windows` required at once        | A flaky Windows test would block every merge before the job proves stable. |

## References

- `.github/workflows/quality.yml`, `scripts/run-tests-isolated.sh`
- [CI](../ci.md), [ADR-001](./001-local-macos-and-github-ci.md), [TDR-026](../tdr/026-windows-test-failures-reached-the-release.md)
