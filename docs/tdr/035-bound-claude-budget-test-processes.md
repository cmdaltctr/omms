# TDR-035: Bound Claude budget test processes

- **Date:** 2026-10-05
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** Bun, Intel macOS, tests, child processes

## Context

Scheduled smoke run `37320513072` failed on macOS 15 Intel during source validation. The Claude budget test exceeded five seconds. Packaging was skipped; the other five platforms passed.

### Root Cause Analysis

Bun killed the scenario child when its enclosing test reached the default 5,000 ms limit. The harness then reported no result. The logs do not identify the Intel child's delay. A 5.5-second startup delay reproduced the parent timeout locally.

The harness also read pipes serially and ignored the exit code. A failed child could print a valid-looking result and pass.

## Decision

- Reuse TDR-028's 45-second child deadline and 60-second enclosing-test limit for all three Claude budget scenarios.
- Share the bounded process runner through `runBunProcess` in `tests/test-process.ts`. Keep `runBunTest`'s existing return shape and 30-second nested test/hook limit.
- Read stdout and stderr concurrently with the exit status. Parse scenario results from stdout only. Include both streams in failure diagnostics.
- Keep all budget, wrapper, and transport assertions unchanged. Leave production code and suite-wide timeouts unchanged.

## Consequences

A slow child has time to complete. Stalled or failed children still fail with diagnostics. Tests can take longer before reporting a stall.

## Alternatives Considered

| Option                    | Rejected because                                                |
| ------------------------- | --------------------------------------------------------------- |
| Retry the job until green | Leaves the deadline mismatch in place                           |
| Raise every test timeout  | Changes unrelated tests and leaves child diagnostics incomplete |
| Skip Intel coverage       | Removes checks on a supported platform                          |

## How to Recognise / Handle This Again

1. Find the first timeout in the job log.
2. Check whether the enclosing test killed a child before it printed its result.
3. Set a child deadline below the enclosing test deadline.
4. Capture both streams and check the exit status before parsing results.
5. Run `bun test tests/claude-budget-timeout-regression.test.ts` and `bun test tests/test-process.test.ts` separately.

## Verification

The delayed-child regression failed at 5,000 ms before the fix and passed afterwards with the real config-edit assertions. Another regression rejects failed children that print valid-looking results. A stderr-only result remains a failure.

A controlled stream fixture detects serial reads. Large-output coverage alone did not detect that mutation because Bun buffered the pipe data. Removing the process deadline or hiding the exit code also caused focused tests to fail. The restored focused files passed 13 tests. Full `bun run ci:local` passed 1,885 tests across 276 isolated files. All 16 original budget and transport assertions remain unchanged. Format, lint, TypeScript, all 28 main specs, and the graph update passed. Aikido scanned four test files and returned zero findings. Intel verification of this fix remains pending.

## Revisit Triggers

Recheck when Bun changes process termination, stream buffering, or test timeout behaviour.

## References

- [Failed Intel job](https://github.com/cmdaltctr/omms/actions/runs/37320513072/job/111798085350)
- [TDR-028](028-test-shutdown-state-and-child-deadlines.md)
- [Claude budget tests](../../tests/claude-injection-budget.test.ts)
- [Timeout regressions](../../tests/claude-budget-timeout-regression.test.ts)
- [Shared process runner](../../tests/test-process.ts)
