# TDR-028: Test shutdown state and give nested tests separate deadlines

- **Date:** 2026-10-04
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** Windows, tests, timers, child-processes

## Context

PR #88 failed Windows CI twice on unchanged tests. Earlier retries of the same
tests had passed during PR #87 and the 4.4.2 release. The repeated failures
blocked the HTTPS marketplace fix.

### Root Cause Analysis

`web-step-aside.test.ts` slept 700 ms and then 1,500 ms after an HTTP reply.
Production starts the hold-off timer only after `stop()` completes its database
cleanup. On Windows, the test could read the health-loop field before the
hold-off timer had even started. The default-delay and callback tests used
similar fixed sleeps.

The retired-snapshot regression launched all of `opencode-web-selection.test.ts`
inside a parent with a 30-second timeout. Each child test also allowed 30
seconds, plus startup and cleanup. The Windows log showed the relevant child
test passing after 25 seconds, then the parent killed the unfinished process.

After those fixes passed on Windows, the same run exposed a third fault:
`profile-catch-up-lease-cleanup.test.ts` launched a child without `--timeout`.
Its database cleanup hook inherited Bun's five-second default, even though the
outer suite used 30 seconds. A six-second cleanup delay reproduced both nested
hook failures locally.

## Decision

- Keep real socket and database shutdown in the step-aside tests. Wait for the
  hold-off timer to be armed, with a bounded deadline and a named error.
- Switch to Bun's controlled clock after shutdown completes. Assert that the
  loop remains off at 1,499 ms and starts at 1,500 ms. Test the default at
  59,999 ms and 60,000 ms, and the reply grace at 99 ms and 100 ms.
- Wait for callback and heartbeat state in the remaining integration cases.
- Run only the relevant snapshot test in the nested regression. Give the child
  process 45 seconds and its parent 60 seconds, while retaining the child's
  30-second test limit. The extra time covers process startup and cleanup.
- Route all six nested Bun test launch sites through `tests/test-process.ts`.
  Pass `--timeout 30000` explicitly to the child, including its hooks. Give the
  process 45 seconds and the parent 60 seconds. A caller can request a shorter
  process deadline for a timeout test.
- Drain child stdout and stderr concurrently. Terminate stalled children before
  the parent deadline so failures include their output.

Production code, assertion outcomes and the suite-wide timeout stay unchanged.
No test is skipped on Windows.

## Consequences

### Positive

- Shutdown duration no longer consumes the hold-off assertion's timing window.
- Timer boundaries are checked precisely without waiting a real minute.
- A nested regression cannot run unrelated tests against one test's time budget.

### Negative

- The timer tests inspect private runtime fields and must follow changes to the
  server's lifecycle implementation.

### Neutral

- Slow operations still fail at bounded deadlines. This does not guarantee that
  every other Windows test is free of timing assumptions.

## Alternatives Considered

| Option                  | Rejected because                                             |
| ----------------------- | ------------------------------------------------------------ |
| Retry until CI passes   | Leaves the same races in the release gate.                   |
| Increase every sleep    | Still measures from the reply instead of completed shutdown. |
| Raise all test timeouts | Hides stalls and does not fix hold-off assertions.           |
| Skip the Windows tests  | Removes coverage on the affected platform.                   |

## Verification

- Injecting a 2.5-second delay after shutdown reproduced the old `loopLate`
  failure locally. `tests/windows-timing-regressions.test.ts` now preserves
  that reproduction and passes with the corrected test.
- A scratch preload delayed the nested snapshot child startup by 31 seconds.
  The original parent timed out; the corrected runner passed at 31 seconds.
- Scratch loader mutations for early hold-off, missing resume, incorrect
  default delay and missing reply grace each failed the matching test.
- Restoring the old snapshot equality assertion caused both the child and the
  retired-snapshot regression to fail.
- The first two fixes passed in Windows run `37195332056` without a retry.
  That run exposed the separate five-second cleanup-hook limit described above.
- Both database cleanup regressions now inject a six-second delay, and still
  require every real libSQL client to be closed before directory removal.
- Shared-runner tests check concurrent pipe draining, failed-child diagnostics
  and stalled-child termination. Removing stderr capture, hiding exit codes,
  dropping the process deadline or omitting the hook timeout each caused the
  relevant regression to fail.
- The launch-site audit covered the cleanup regression, both release regression
  launch sites, the two web wrappers and the slow-shutdown regression. None now
  invokes a child test runner without the shared deadline policy.
- Focused tests, `bun run check` and full `bun run ci:local` passed across
  249 isolated test files. Aikido returned zero findings for the seven changed
  test/helper files. Windows CI for the shared-runner change remains pending.

## How to Recognise / Handle This Again

1. Read the failing assertion and the child's output before rerunning a job.
2. Identify the event that starts the duration being tested.
3. Wait for that event, then control the clock for exact timer assertions.
4. Keep child-process deadlines below the enclosing test deadline.
5. Inject delays and broken behaviour to verify both success and failure paths.

## Revisit Triggers

Recheck after a Bun timer API change, a shutdown lifecycle change, or a new
Windows timing failure. A recurrence requires investigation before another retry.

## References

- [Earlier Windows failures](026-windows-test-failures-reached-the-release.md)
- [Step-aside tests](../../tests/web-step-aside.test.ts)
- [Release regressions](../../tests/release-smoke-regressions.test.ts)
- [Slow-shutdown regression](../../tests/windows-timing-regressions.test.ts)
- [PR #88](https://github.com/cmdaltctr/omms/pull/88)
