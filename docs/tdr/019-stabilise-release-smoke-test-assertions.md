# TDR-019: Stabilise release smoke test assertions

- **Date:** 2026-10-01
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Windows, Bun, tests, release

## Context

The follow-up to the failed 4.0.0 release exposed failures in the OpenCode snapshot test on Windows and the package skill test on macOS.

### Root Cause Analysis

A refreshed session listing retires its previous snapshot. Windows may delay deletion while file locks clear. The snapshot test compared the entire folder set before and after a dry-run import. A retired folder disappeared during the import, so the test failed even though the import reused the current copy.

The package test used Bun's default five-second timeout. A slow `npm pack` exceeded that limit. Bun killed the child, and the test tried to parse its incomplete output as JSON.

## Decision

Check that the import creates no new snapshot folders. Also verify that it acquires the existing snapshot in reuse mode and reads the same path. Allow retired copies to finish deleting. Keep the final assertion that every owned snapshot is removed, with a bounded wait for pending cleanup.

Give the package test 30 seconds and check the child exit code before parsing its output. Keep the real npm packaging assertion.

Add child-process regressions that simulate a disappearing retired snapshot and a six-second package operation. Confirm both fail before applying the fixes.

## Consequences

### Positive

- Snapshot assertions check reuse while allowing expected cleanup.
- A slow package operation can finish and still must contain the memory skill.

### Negative

- The delay regression adds about six seconds to the suite.

### Neutral

- Production snapshot and package behaviour stay unchanged.

## Alternatives Considered

| Option                                        | Rejected Because                                      |
| --------------------------------------------- | ----------------------------------------------------- |
| Wait a fixed delay before comparing snapshots | Runner load and file locks change the required delay. |
| Skip packaging on slow runners                | The published skill would lose coverage.              |

## How to Recognise / Handle This Again

1. Compare the snapshot diff for additions and deletions.
2. Check whether the missing folder belongs to a retired copy.
3. Verify the current snapshot path and acquisition mode.
4. Check package child exit status before parsing output.
5. Run local CI and all six platform smoke jobs before merging.

## Revisit Triggers

- The snapshot registry changes how it retires copies.
- Normal package operations exceed the new timeout.

## References

- [Windows smoke failure](https://github.com/cmdaltctr/omms/actions/runs/36837013784)
- [macOS package test failure](https://github.com/cmdaltctr/omms/actions/runs/36836984199)
- `tests/opencode-web-selection.test.ts`
- `tests/package-skills.test.ts`
- `tests/release-smoke-regressions.test.ts`
