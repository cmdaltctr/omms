# TDR-029: Wait for backfill test children to finish cleanup

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** OMMS maintainer
- **Tags:** Windows, tests, backfill, child-processes

## Context

PR #89 passed local CI and the Linux and macOS GitHub jobs. Windows failed
`tests/backfill-lock.test.ts` at the final empty-claim assertion. PR #88's timing
fixes were merged into this branch; they leave this test unchanged.

### Root Cause Analysis

The two contender processes correctly reported one acquired claim and one
refusal. Test cleanup then gave each child one second to exit and force-killed
a child that exceeded that limit. A winner killed before its awaited release
completes leaves its claim in the database.

A scratch preload delayed the winning child's release by 1.5 seconds and
reproduced the exact assertion failure. The normal case passed all six tests.
The permanent delayed-cleanup regression also failed before the fix.

## Decision

Keep the existing acquisition, token, crash-recovery, and empty-claim assertions.
Run the contender fixture with the same Bun executable as its parent. Drain
stdout and stderr from process launch.

After signalling release, wait for both children concurrently. Give each child
five seconds for cleanup and clear its timer on exit. Reap every child before
reporting a timed-out or non-zero exit, including captured output. Give these
cases a 20-second parent limit for startup, coordination, and cleanup.

Run the same real database race with zero delay and a 1.5-second release delay.
Production locking code and the suite-wide timeout remain unchanged.

## Consequences

### Positive

- A slow successful release can complete before the claim assertion runs.
- Failed children produce diagnostics after every child has been reaped.
- The regression reproduces the premature-kill fault without Windows.

### Negative

- A stalled contender takes up to five seconds to produce a failure.

### Neutral

- The fix changes test orchestration only.

## Alternatives Considered

| Option                                  | Rejected because                                                  |
| --------------------------------------- | ----------------------------------------------------------------- |
| Retry until Windows passes              | Leaves the premature-kill path in the gate.                       |
| Skip the race or empty-claim assertion  | Removes the behaviour that the test must verify.                  |
| Delete the leftover claim in the parent | Hides whether the winning child released its claim.               |
| Raise the suite-wide timeout            | The child was killed by its separate one-second cleanup deadline. |

## How to Recognise / Handle This Again

1. Check whether the concurrency assertions passed before cleanup failed.
2. Inspect child exit codes and captured output.
3. Inject a release delay longer than the original cleanup budget.
4. Verify that shortening the cleanup deadline makes the regression fail.
5. Verify that omitting release still fails the empty-claim assertion.

## Verification

- The delayed-release regression failed before the fix: six passed, one failed.
- The corrected file passes all seven tests.
- A one-second deadline, omitted release, and forced child error each fail the regression.
- The failure guard runs after `finally`, preserving earlier assertion failures.
- Aikido scanned the changed test file with zero findings.
- Final local CI passed: 1,682 tests across 253 isolated files, with zero failures.

## Revisit Triggers

Recheck after Bun process-lifecycle changes or another child-cleanup failure.
Keep child deadlines below the enclosing test deadline.

## References

- [Backfill race tests](../../tests/backfill-lock.test.ts)
- [Previous timing fixes](028-test-shutdown-state-and-child-deadlines.md)
- [CI guidance](../ci.md#timing-tests-and-child-processes)
- [PR #89](https://github.com/cmdaltctr/omms/pull/89)
