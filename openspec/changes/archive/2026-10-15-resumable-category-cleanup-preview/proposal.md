# Proposal

## Why

Every category cleanup preview asks the profile model about every group again. On a 1,844-label profile that is about 16 model calls of up to 180 seconds each, around 30 minutes. A rebuild after profile learning, a restart or a timed-out batch repeats all of it. Last night's preview left 120 of 304 groups unchecked because 6 batches timed out, and rebuilding would repeat the work that already succeeded.

## What Changes

- Save each model verdict (the labels kept and the proposed name) per group, right after its batch returns.
- A new preview groups the current labels again, reuses a saved verdict for each group whose label set is unchanged, and sends only the other groups to the model.
- A failed, timed-out or missing reply saves nothing, so the next preview retries exactly those groups.
- Verdicts older than 30 days, and verdicts for groups that no longer exist, are deleted.
- The progress count covers only the batches that will run.
- The preview log line gains phase durations, to confirm where the time goes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-category-cleanup`: adds a requirement that model verdicts are reused between previews.

## Impact

- `src/services/user-profile/category-cleanup.ts` (`checkAndNameGroups`, `previewCategoryCleanup`)
- `src/services/user-profile/category-cleanup-store.ts` (new verdict table in `user-profiles.db`)
- `tests/category-cleanup-naming.test.ts`, `tests/category-cleanup-service.test.ts`
- `docs/using-memory.md`, `docs/cli.md`, a new TDR
- The CLI and the web app share this code, so every host and the CLI benefit.
- Depends on `fix-cleanup-apply-after-learning` only for the same files. The two changes touch different functions and can land in either order.
