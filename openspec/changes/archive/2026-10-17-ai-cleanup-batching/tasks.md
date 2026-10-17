# Tasks

## 1. Batching in the shared cleanup code

- [x] 1.1 Write tests in `tests/ai-cleanup-batches.test.ts` for `splitIntoBatches`: at most 100 items per batch, every item in exactly one batch, sections never mixed, a category of 100 or fewer items never split, a category of more than 100 items cut into chunks of 100. Run `bash scripts/run-tests-isolated.sh tests/ai-cleanup-batches.test.ts` and confirm the tests fail before the module exists.
- [x] 1.2 Add `AI_CLEANUP_BATCH_SIZE = 100` to `src/services/request-timeouts.ts`. Create `src/services/user-profile/ai-cleanup-batches.ts` with `splitIntoBatches`. Confirm the 1.1 tests pass.
- [x] 1.3 Write tests for `runInBatches` with a fake `callBatch`: results join across batches, a failed batch keeps its items and counts in `failedBatches` and `failedItems`, every batch failing throws the first error, the stop flag prevents the next call and returns nothing, and the log records hold no item text. Confirm they fail, then implement `runInBatches` and confirm they pass.
- [x] 1.4 Confirm `src/services/user-profile/ai-cleanup.ts` did not grow, and run `tests/ai-cleanup.test.ts` to confirm it still passes unchanged.

## 2. Apply as edits on the newest profile

- [x] 2.1 Write tests in `tests/ai-cleanup-apply-edits.test.ts` for `applyCleanupEdits`: a ticked removal and a ticked merge apply; unticked changes do nothing; a kept item reworded by the model keeps its stored wording; an item learning added during the run is kept; a frequency bump on a selected item does not block a match; a ticked merge whose item learning reworded is skipped with no duplicate; duplicated descriptions remove one occurrence only; the skipped count is returned. Confirm the tests fail first.
- [x] 2.2 Create `src/services/user-profile/ai-cleanup-apply.ts` with `applyCleanupEdits`, using the existing identity key. Confirm the 2.1 tests pass.
- [x] 2.3 Move each case of `tests/ai-cleanup-apply.test.ts` onto `applyCleanupEdits`. Where a case checks behaviour the spec removes, replace it with a test of the new rule and record the case name for the PR description. Confirm no remaining assertion is weaker than before.

## 3. Background job and endpoints

- [x] 3.1 Write tests in `tests/ai-cleanup-job.test.ts` with a fake batch runner: start returns at once; a second start returns the running job; progress counts done, total and failed; done keeps the result for Apply; stop clears the job and no later batch runs; a done job expires after 30 minutes; an empty selection becomes every item id. Confirm they fail first.
- [x] 3.2 Create `src/services/user-profile/ai-cleanup-job.ts`. Confirm the 3.1 tests pass.
- [x] 3.3 Create `src/services/ai-cleanup-handlers.ts` with start, status, stop and apply. Apply loads the newest profile, calls `applyCleanupEdits`, saves with the version check, and retries at most three times on a conflict. Add tests for: a stale `profileVersion` at start fails at once; Apply succeeds after learning saved a newer version; three conflicts in a row leave the profile unchanged with the try-again message. Confirm they fail first, then pass.
- [x] 3.4 Remove `handleAICleanup`, `handleApplyCleanup`, `pendingCleanups` and `mergeCleanupIntoProfile` from `src/services/api-handlers.ts`. In `src/services/web-server.ts`, replace the two blocks with POST, GET, DELETE and apply routes that call the new handlers. Add route tests. Run `bash scripts/run-tests-isolated.sh tests/file-size-ceiling.test.ts` and lower the ceiling entries for `web-server.ts` and `api-handlers.ts` to their new sizes.

## 4. Dialog: progress, stop, failure state, reopen

- [x] 4.1 Write tests in `tests/ai-cleanup-job-state.test.ts` for the pure module: running shows progress with batch X of Y; done shows review with the failed-batch notice when above 0; failed shows the error with Retry; open with a running job shows progress; Stop returns to the selection with the same items; Retry starts with the same selection; polling stops on done, failed or close. Confirm they fail first.
- [x] 4.2 Create `web/src/lib/components/explorer/ai-cleanup-job-state.ts` and the client calls in `web/src/lib/api.ts`. Confirm the 4.1 tests pass.
- [x] 4.3 Update `AiCleanupDialog.tsx` to use the module and a 2-second poll. Show batch X of Y with a Stop button, the failure state with Retry and Back, the failed-batch notice and the skipped-change count after Apply. Stop sending `profile` to Apply. Add English, Chinese and Arabic keys in `web/src/lib/i18n/translations.ts`. Confirm `bun run check` passes and the dialog file is not longer than 527 lines.

## 5. Docs and records

- [x] 5.1 Update `docs/web-ui.md`: batches, progress, Stop, close and reopen, a failed batch, the error and Retry, Apply on a newer profile, kept items keep their wording, and duplicates across batches. Grep `docs/` and `README.md` for other AI Cleanup text and fix each hit that describes one request or the "Profile changed" refusal.
- [x] 5.2 Write `docs/adr/029-ai-cleanup-runs-as-a-batched-job.md` from `docs/adr/TEMPLATE.md`, covering the job, batching and Apply as edits, with a link to ADR-028. Add it to `docs/adr/README.md`.
- [x] 5.3 Write `docs/tdr/051-ai-cleanup-timeout-on-large-selections.md` with the log evidence and the measured batch time from 6.3. Add it to `docs/tdr/README.md`.
- [x] 5.4 Run `openspec validate ai-cleanup-batching --strict` and confirm it passes.

## 6. Integration checks

- [x] 6.1 Run `bun run ci:local` in the worktree and confirm it passes.
- [x] 6.2 Build. Make a scratch home folder and copy `~/.omms` config and `data/user-profiles.db` into it; never copy `.env`. Set a spare `webServerPort` in the scratch config, then start the web app from this worktree with `HOME` pointing at the scratch folder. In the Orca browser, run Low Freq and Same Category (3+). Confirm batch X of Y, close and reopen during a run, Stop, and a finished review. Force one failure with an unreachable `memoryApiUrl` and confirm the error and Retry. Apply on the scratch copy only.
- [x] 6.3 Read `callMs` for the batches in the scratch log and confirm the slowest is under 30 seconds. If not, lower `AI_CLEANUP_BATCH_SIZE`, update the spec and repeat 6.2.
