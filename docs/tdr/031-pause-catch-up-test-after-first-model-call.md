# TDR-031: Pause the catch-up test after the first model call

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** OMMS maintainer
- **Tags:** tests, profile-catch-up, race

## Context

Post-merge Quality run `37204321686` (commit `178dc8d`) failed only on
Windows. The first case of `tests/web-profile-catch-up.test.ts` reached its
30-second limit, and Bun killed the child with exit code 143. The same test
passed on 20 other Windows runs in 2.7 to 11.2 seconds. Those runs include the
same source and tests before and after the merge.

A scratch copy with phase marks did not reproduce the timeout on macOS. It ran
200 times under CPU load with no failure; the slowest child took 464 ms. The
Windows timeout cause stays unknown. The maintainer parked it.

### Root Cause Analysis

The phase marks showed a separate race. The scenario sent Pause straight after
Start. The first model call came 2 ms after Pause. The run still built one
batch, because the background drain had already passed its abort checks.

A slower drain lets Pause arrive before those checks. The run then stops with
no batch, which is correct product behaviour. The test expects one batch.

A scratch 50 ms delay after `skipTrivialPromptsForLearning` in
`src/importer/profile-backlog.ts` reproduced this every time:
`paused` was `{ batchesBuilt: 0, remaining: 120 }` instead of
`{ batchesBuilt: 1, remaining: 70 }`.

## Decision

The scenario waits until the stub model receives its first call, then sends
Pause. The wait checks every 10 ms and throws `no model call` after 200 checks.
The stopped-run case in the same file already waits like this. No source code
or existing assertion changed.

## Consequences

### Positive

- Pause always lands while batch 1 is in flight, so the expected state is
  fixed.

### Negative

- None known.

### Neutral

- This does not explain or fix the Windows 30-second timeout.

## Alternatives Considered

| Option                          | Rejected Because                                        |
| ------------------------------- | ------------------------------------------------------- |
| Accept zero or one paused batch | Weakens the assertion on the pause-between-batches path |
| Raise the test timeout          | No evidence that the timeout was a slow pass            |

## How to Recognise / Handle This Again

1. Symptom: `paused` shows `batchesBuilt: 0` and all prompts remaining.
2. Add a short delay before the drain's first abort check and run the file.
3. Make the scenario wait for the in-flight event before it sends Pause.

## Revisit Triggers

- The Windows 30-second timeout happens again. Add phase marks to the child
  and collect them from Windows CI.

## References

- `tests/web-profile-catch-up.test.ts`
- `src/importer/profile-backlog.ts`
- [TDR-028](./028-test-shutdown-state-and-child-deadlines.md)
