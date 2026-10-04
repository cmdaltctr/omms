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
- Focused tests and `bun run check` passed. Full `bun run ci:local` passed across
  248 isolated test files. Aikido returned zero findings for all three changed
  test files. Windows CI verification remains pending.

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
