# TDR-043: Honour profile pause and bound conflict checks

- **Date:** 2026-10-09
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** profile-learning, import, pause, model-call-budget

## Context

A forced OpenCode profile-only import continued after the Pause endpoint returned success. Investigation also found that conflict detection could make more than the apparent three-check limit. The user approved fixing both bugs in the existing worktree, without a new spec or worktree. The import was stopped before any rebuild.

### Root Cause Analysis

- Exchange progress reads the persisted pause flag. Profile progress only wrote its counters, so a profile-only run never invoked the pause callback.
- `detectConflicts` incremented `checked` only when the model confirmed a conflict. Negative answers left the budget unchanged. A synthetic pass with eight candidate pairs made eight calls.

## Decision

- Read the pause flag after each queued profile-progress write in `import-runs.ts`. Set `pauseRequested` and notify `onPause` once, sharing that state with exchange progress. Keep queued writes and existing error handling.
- Increment the conflict-check budget immediately before calling `checkConflict`. Skip already removed candidates first. Keep the three-check limit and positive conflict handling unchanged.
- Keep provider choice, embeddings, duplicate checking and `mergeItems` unchanged. Jev remains a separate evaluation question.

## Consequences

### Positive

Profile-only imports observe Pause. Each conflict pass checks at most three candidate pairs, including negative answers.

### Negative

The cap can leave lower-ranked conflict candidates for later passes. Pausing waits for the current batch; it does not cancel every model request already in flight.

### Neutral

Completed batches stay learned. Tests use isolated homes and stores; the paused live import is not resumed by validation.

## Alternatives Considered

| Option                                   | Rejected because                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Rely on terminating the process          | Interrupts the current batch instead of observing a checkpoint boundary. |
| Change providers first                   | Leaves the pause defect and excessive-check behaviour in place.          |
| Add caching or change conflict selection | Expands this repair beyond the two approved control fixes.               |

## How to Recognise / Handle This Again

1. Check the import phase when a pause flag is set but work continues.
2. Verify both progress paths read that flag and notify once.
3. Count conflict-check calls when every answer is negative.
4. Confirm the call count stays within the configured code limit.

## Revisit Triggers

Evaluate batching, caching and a decision model if the bounded checks remain slow. Measure false merges and latency before changing providers.

## Verification

The two conflict regressions first failed with eight calls where three were expected, then passed after the fix. Four pause assertions failed before the flag read was added; all six pause tests then passed. Existing import, progress, workflow and category merge checks passed.

The first combined CI run hit the unchanged intermittent `web-ensure` lock-rename failure. That file passed its isolated rerun. The full CI rerun returned real exit `0`: `/tmp/omms-control-fixes-ci.quErVP`. A separate read-only review found no defects within the two fixes. The live import stayed stopped.

## References

- `src/importer/import-runs.ts`
- `src/services/user-profile/user-profile-manager.ts`
- `tests/profile-phase-pause.test.ts`
- `tests/profile-conflict-call-limit.test.ts`
- [Profile check limits](../using-memory.md#profile-check-limits)
