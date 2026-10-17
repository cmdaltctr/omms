# Design

## Context

See proposal.md for the problem. Observed on the live profile (v4.19.1) through the Orca browser on 2026-10-16:

- Low Freq sent 2,045 items (prompt 549 KB). Same Category (3+) sent 744 items (238 KB). Both ran about 60 seconds, then the dialog returned to the selection screen.
- The server log has `handleAICleanup: error: TimeoutError` for each run, and no `AI response received` line for any recent run. The time one batch takes is not known yet.
- The profile reached versions 535 to 539 within one hour. Version 539 was saved at 23:08:34, while the Same Category run was in progress.
- `callViaExternalAPI` in `src/services/user-profile/ai-cleanup.ts` has a 60-second `AbortSignal.timeout`. The host model path has no limit of its own.
- `handleAICleanup` runs the model call inside the web request and stores the result in `pendingCleanups` (per user, 30 minutes). `handleApplyCleanup` refuses when the stored version changed.
- `mergeCleanupIntoProfile` replaces the whole selection with the model's output. Kept items therefore take the model's wording (`rebuildProfileUsing` prefers the cleaned item), which the review screen never shows. Against a newer profile this approach would also duplicate items that learning changed.
- The dialog sends `profile: pendingCleanup.new` to Apply, and the server uses it as the cleaned data.
- Item ids (`pref_12`) are positions in the full, sorted profile, so they stay unique across batches.
- The OpenCode automatic cleanup calls `aiCleanupProfile` on the whole profile every 100 prompts and saves without review. It does not use `pendingCleanups` or `mergeCleanupIntoProfile`.
- Clean up categories already runs as a per-user in-memory job (`category-cleanup-job.ts`) with a polling endpoint.
- `web-server.ts`, `api-handlers.ts`, `ai-cleanup.ts` and `AiCleanupDialog.tsx` are at or over the 500-line limit and listed in `tests/file-size-ceiling.test.ts`. They may shrink but not grow.
- `web/` has no test runner. Root tests in `tests/` import modules from `web/src/` directly.

## Goals / Non-Goals

**Goals:**

- Any selection, up to the whole profile, finishes through the external API or the host model.
- The user sees progress, can stop a run, and sees why a run failed.
- Apply works when learning saved during the run, and changes only what the user ticked.

**Non-Goals:**

- No change to the OpenCode automatic cleanup. It keeps `aiCleanupProfile` with one call.
- No merge across batches.
- No parallel batches.
- No change to the 60-second limit of one call, or to the prompt text.
- No resume of a job after a restart of the web app.

## Decisions

### 1. Batching in a new shared module

New `src/services/user-profile/ai-cleanup-batches.ts`:

- `splitIntoBatches(indexed, size)`: the caller indexes the full profile once and filters it by the selection. For each section, sort by lower-cased category, then by position. Group by category. Add each category group to the current batch if it fits; otherwise start a new batch. A group larger than `size` is cut into chunks of `size`. Sections never share a batch.
- `runInBatches(batches, { callBatch, onProgress, isStopped })`: runs batches one after another. `callBatch` defaults to `aiCleanupProfileFromIndexed`, so the model call, `rebuildProfileUsing` and `generateDiff` stay as they are. The result concatenates `cleaned` and `diff` across batches and adds `failedBatches` and `failedItems`. A failed batch adds nothing to the diff. If every batch fails, it throws the first error. `isStopped` is checked before each batch and after each call; when it is true, the run ends and returns nothing.

`ai-cleanup.ts` does not change, apart from exports if needed.

- **Why pack by category:** the prompt merges only within a section, and items with the same category are the likeliest duplicates.
- **Alternative: embedding clusters,** as Clean up categories does. Better recall, but an extra step, a new failure mode and more time. A later change can swap the sort.
- **Alternative: plain chunks of 100.** Simpler, but it scatters categories and loses merges.

### 2. Batch size 100, one constant

`AI_CLEANUP_BATCH_SIZE = 100` in `src/services/request-timeouts.ts`. A batch of 100 has a prompt of about 27 to 32 KB, about one eighth of the 238 KB request that timed out. Task 6.3 measures a real batch. If it takes more than 30 seconds, the constant and the spec go down together.

### 3. The job owns the pending result

New `src/services/user-profile/ai-cleanup-job.ts`, shaped like `category-cleanup-job.ts`:

```text
{ state: "running", done, total, failed }
{ state: "done", result: { old, changes, failedBatches, failedItems } }
{ state: "failed", error }
```

The job also keeps the selection, the profile it read, the cleaned data and the merged and removed lists. This replaces `pendingCleanups`, so there is one store. A done job is cleared on Apply, on discard, on a new start, and 30 minutes after it finished (the old `pendingCleanups` expiry). Stop sets a flag and clears the job at once, so the dialog can start again; the running loop sees the flag and ends without writing anything.

An empty selection becomes every item id of the profile at start, so Apply always works on a known list.

### 4. Handlers and routes in new files

New `src/services/ai-cleanup-handlers.ts` holds start, status, stop and apply. The `handleAICleanup`, `handleApplyCleanup`, `pendingCleanups` and `mergeCleanupIntoProfile` code leaves `api-handlers.ts`. In `web-server.ts`, the two existing blocks become four short routes on `/api/user-profile/ai-cleanup`: `POST` (start), `GET` (status), `DELETE` (stop or discard) and `POST .../apply`. Both files get shorter.

The start handler keeps the current checks that answer at once: "No profile found" and a stale `profileVersion` from the dialog.

- **Alternative: keep one POST and raise the limits.** A run of 20 or more batches outlasts the 180-second dialog limit and the 330-second server idle limit, and gives no progress.
- **Alternative: the dialog loops over batches.** The loop would stop when the tab closes, and the server still needs state to combine the results.

### 5. Apply as edits on the newest profile

New `src/services/user-profile/ai-cleanup-apply.ts` with `applyCleanupEdits(current, job, accepted)`:

1. Find each item of each ticked change in `current` by the existing identity key (category, description, steps). It ignores frequency and confidence, so learning's counters do not break the match.
2. Skip a change when any of its items is missing. Count it.
3. For a ticked removal, remove the matched item.
4. For a ticked merge, remove the source items and replace the target with the merged item from the job's cleaned data.
5. Leave every other item as it is in `current`.

The handler loads the newest profile, applies the edits, and saves with the version check. On a conflict it loads again and repeats, at most three times, like learning after a save conflict. The request field `profile` is accepted and ignored; the server uses the job's own result.

This changes one behaviour on purpose: kept items no longer take the model's unreviewed wording. The existing tests in `tests/ai-cleanup-apply.test.ts` move to the new function. A case that checks behaviour this design removes (for example, full replacement when `includeIds` is unset) is replaced by a test of the new rule, and the PR lists each such case.

- **Alternative: keep refusing a newer version.** Most large runs would end in "Profile changed" while agents are active.
- **Alternative: keep `mergeCleanupIntoProfile` and add patches for stale items.** It would need special handling for kept copies, frequency changes and duplicates. Edits avoid all three.

### 6. Dialog state in a pure module

New `web/src/lib/components/explorer/ai-cleanup-job-state.ts` holds the phase logic as pure functions: which screen to show for a job state, when to poll, and what Stop, Retry and Close do. Root tests in `tests/` cover it. A small hook in the dialog polls every 2 seconds while the job runs and the dialog is open. On open, the dialog reads the job first: running shows progress, done shows review, failed shows the error. Otherwise it shows the selection. The inline fetch leaves `AiCleanupDialog.tsx`, so the file does not grow.

### 7. Failure text and logging

A failed batch logs `AI cleanup: batch failed` with the batch number, the item count and a reason code: `timeout`, `http-<status>`, `invalid-reply` or `error`. Each finished job logs one record with the batch counts and the total time. No record contains item text, prompts or replies. The job error is a fixed sentence for `timeout` ("The model did not answer in time") and the error message with keys redacted otherwise.

## Risks / Trade-offs

- [A batch of 100 may still take more than 60 seconds on a slow model] → Task 6.3 measures it; the constant is one edit. A failed batch is reported, not lost. Measured: a reasoning model needs 60 to 95 seconds per batch; with reasoning off, `deepseek-flash` needs 13 to 22 seconds. `docs/web-ui.md` tells the user to turn reasoning off with `memoryExtraParams` (TDR-051).
- [Duplicates across batch boundaries do not merge] → Category packing keeps the likeliest ones together. A second run after Apply catches the rest. `docs/web-ui.md` says so.
- [A full-profile run can take 20 minutes or more] → Progress, Stop and reopen make it visible and controllable.
- [Jobs are lost on restart] → Same as the category job. Nothing is saved before Apply.
- [A merge target's frequency raised by learning during the run is replaced by the merged item's count] → Small loss on one counter. The merged item already sums the frequencies of its sources.
- [Apply ignores the `profile` field the dialog sends] → The dialog is the only client, in the same package. The dialog stops sending it.
- [Kept items keep their stored wording] → Intended. The review screen never showed those rewrites.
