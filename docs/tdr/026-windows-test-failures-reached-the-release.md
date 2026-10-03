# TDR-026: Windows test failures reached the release smoke

- **Date:** 2026-10-03
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Windows, tests, CI, release

## Context

The 4.4.0 Release workflow failed on `windows-latest`. The other five platforms passed. `publish` was skipped, so 4.4.0 exists only as a tag and a GitHub Release. 4.4.1 shipped the same changes.

### Root Cause Analysis

The code users run was correct on Windows. The tests were not.

- Pull request CI ran tests only on macOS, so Windows ran them first in the release smoke.
- `scripts/run-tests-isolated.sh` stopped at the first failing file. Each smoke run showed one failing file, and the next appeared only after a fix. Finding all of them took five runs.

| Test file                   | Why it failed on Windows                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `global-version`            | Built a Linux install folder but named no platform, so Windows looked for the `.cmd` layout.     |
| `omms-launch`               | Linux install folder, `/` separators, and a shell-script fake `npx` with a `:` `PATH` separator. |
| `web-settings-api`          | Put a symlink on `PATH`. Windows finds `.cmd` wrappers, and a symlink needs extra rights.        |
| `opencode-web-ensure`       | Waited a fixed 50 ms for a background call. Too short on a slow runner.                          |
| `cli-handoff` (macOS Intel) | Called the real npm registry and passed bun's 5 second test limit.                               |
| `web-ensure-real-process`   | A six-process start-lock race failed once. Not reproduced since.                                 |

## Decision

1. Fix each test: name the platform, build paths with `join`, use a batch-file fake `npx` on Windows, wait for the expected call, turn off the npm lookup, and skip the symlink test on Windows. No source code changed.
2. Make the runner run every file, list each failed file, and exit 1 (#82).
3. Run the suite on Windows in pull request CI ([ADR-020](../adr/020-pull-requests-test-on-windows.md)).
4. Make `web-ensure-real-process` print the child's error on failure, so the next failure shows its cause.

## Consequences

### Positive

- One smoke run now shows every failure on a platform.
- Windows test failures show on the pull request.

### Negative

- The start-lock race is not understood. It may be a real race in `src/services/web-ensure.ts`, or load on the runner.

## Alternatives Considered

| Option                             | Rejected Because                                                |
| ---------------------------------- | --------------------------------------------------------------- |
| Skip every failing test on Windows | Hides real Windows behaviour. Only the symlink test is skipped. |
| Fix one failure per smoke run      | Took five runs, about an hour each round trip.                  |

## How to Recognise / Handle This Again

- Symptom: the release smoke fails only on `windows-latest`, and `publish` is skipped.
- Read the summary at the end of the Windows job log: `N test file(s) failed:`, then the list. Each file is also an error annotation on the job.
- Reproduce a platform-path failure on macOS by faking the platform:
  `echo 'Object.defineProperty(process, "platform", { value: "win32" });' > /tmp/win32.ts`, then `bun test --preload /tmp/win32.ts tests/<file>.test.ts`.
- Reproduce a timing failure by delaying the mocked call, or block the network with `HTTPS_PROXY=http://10.255.255.1:9`.
- Before you merge the fix, run `gh workflow run platform-smoke.yml --ref <branch>` once.
- Add the not-published note to the failed GitHub Release. See the release runbook in `docs/ci.md`.

## Revisit Triggers

- `web-ensure-real-process` fails again. Read the child's error and decide if `web-ensure.ts` needs a fix.
- `test-windows` becomes a required check.

## References

- PR #82, `scripts/run-tests-isolated.sh`, `.github/workflows/quality.yml`
- [ADR-020](../adr/020-pull-requests-test-on-windows.md), [TDR-023](./023-wait-for-pi-test-background-calls.md)
