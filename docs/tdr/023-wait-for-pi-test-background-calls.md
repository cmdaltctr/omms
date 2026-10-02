# TDR-023: Wait for Pi test background calls

- **Date:** 2026-10-02
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Pi, Bun, tests, release

## Context

The 4.3.0 release smoke failed on macOS 26. The Pi session-start test expected one web-start call and observed zero. Five other platforms passed. Retrying the same commit passed.

### Root Cause Analysis

Pi starts the web app through dynamic imports without blocking session start. The test waited 10 milliseconds before reading its mock calls. Import completion can take longer on a busy runner. Login-item and backfill assertions used the same fixed wait.

## Decision

Wait for the expected mock call or abort signal. Bound each condition wait to one second and each scenario process to three seconds. Keep the web-start mock permanently pending, so session start still has to return without waiting for the web app.

Add a child-process regression that delays mock call recording by 50 milliseconds. It must exercise login-item reconciliation, both web-start cases and backfill shutdown. The old assertions failed all four scenarios. Add a separate test for a condition that never becomes true.

## Consequences

### Positive

- Startup assertions wait for the event they check.
- Missing calls still fail within a fixed limit.
- Backfill shutdown keeps its abort and store-close assertions.

### Negative

- The delay regression adds child processes to the suite.

### Neutral

- Production code and the published package stay unchanged.

## Alternatives Considered

| Option                     | Rejected Because                      |
| -------------------------- | ------------------------------------- |
| Increase the fixed sleep   | Runner load can still exceed it.      |
| Retry every failed release | Retries leave the test race in place. |

## How to Recognise / Handle This Again

1. Check whether the assertion follows a fixed sleep.
2. Identify the background call or signal that the test expects.
3. Wait for that condition with a deadline.
4. Simulate delayed completion and confirm the old assertion fails.
5. Run `bun test tests/pi-extension.test.ts` and `bun test tests/release-smoke-regressions.test.ts`.

## Revisit Triggers

- Pi changes how it starts or stops background work.
- Normal scenario startup exceeds the condition deadline.

## References

- [4.3.0 Release run](https://github.com/cmdaltctr/omms/actions/runs/36984792982)
- [TDR-019](019-stabilise-release-smoke-test-assertions.md)
- `tests/pi-extension.test.ts`
- `tests/release-smoke-regressions.test.ts`
- `src/adapters/pi/extension.ts`
