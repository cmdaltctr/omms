# Proposal

## Why

AI Cleanup sends every selected item to the profile model in one request. The external API call stops after 60 seconds (`EXTERNAL_PROFILE_CLEANUP_TIMEOUT_MS`). On the live profile, **Low Freq (≤3)** selects 2,045 items and **Same Category (3+)** selects 744. Both calls time out. The dialog then goes back to the selection screen, and the only sign of failure is a toast that disappears. The server log shows `TimeoutError` for every run. The user cannot use the shortcuts that the dialog offers.

A second problem appears once the run is split up. A large run takes 10 to 20 minutes, and profile learning saved a new version 5 times in one hour on the same evening. Apply refuses any result when the version changed, so most large runs would end in "Profile changed".

## What Changes

- AI Cleanup splits the selected items into **batches** of at most 100 and sends one batch per model call. A batch holds one section only. Items with the same category go in the same batch where they fit, so likely duplicates can still merge.
- The web app runs the batches as a **background job**, as Clean up categories does. The dialog starts the job and polls its state. No web request stays open for the whole run.
- The loading screen shows **batch X of Y** and a **Stop** button. Closing the dialog leaves the job running. Opening it again shows the progress, or the review screen when the job is done.
- A batch that fails or times out leaves its items unchanged. The other batches continue. The review screen says how many batches failed.
- When every batch fails, the dialog shows the **error and a Retry button** in its body. It no longer drops back to the selection screen with only a toast.
- **Apply uses the newest profile.** When learning saved a new version during the run, Apply puts the ticked changes into the newest profile instead of refusing. A change whose items learning altered or removed is skipped, and the result says how many were skipped. The save still checks the version, as ADR-028 requires.

Out of scope: the automatic cleanup that OpenCode runs every 100 prompts keeps its single call and is not changed here. Pi and Claude Code have no automatic cleanup. A follow-up change, `remove-auto-profile-cleanup`, will remove it, so all three hosts clean up only through the reviewed dialog.

## Capabilities

### New Capabilities

- `profile-ai-cleanup`: how AI Cleanup splits a selection into batches, runs them as a job with progress, handles a failed batch, shows a failure, and applies the result to the newest profile.

### Modified Capabilities

None. The label rules and the version check in `profile-learning` still apply to the Apply save and do not change.

## Impact

- Shared code: new `src/services/user-profile/ai-cleanup-batches.ts`, `ai-cleanup-job.ts` and `ai-cleanup-apply.ts`; new `src/services/ai-cleanup-handlers.ts`. Code moves out of `src/services/api-handlers.ts`, which shrinks.
- Web API: `POST /api/user-profile/ai-cleanup` starts a job and returns at once. New `GET` returns the job state and `DELETE` stops it. `POST /api/user-profile/ai-cleanup/apply` keeps its request shape and stops refusing a newer version.
- Web UI: `AiCleanupDialog.tsx` (progress, Stop, failure state, reopen), a new pure state module, and translations in English, Chinese and Arabic.
- Hosts: no adapter changes. All three hosts open the same web dialog.
- Docs: `docs/web-ui.md`, a new ADR, and a TDR for the timeout finding.
- No new dependencies. No storage change.
