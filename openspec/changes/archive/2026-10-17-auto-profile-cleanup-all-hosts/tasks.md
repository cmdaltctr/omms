# Tasks

Run a focused test with `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. For every new test, confirm it fails before the code exists, then passes, then fails again when the code is broken on purpose.

## 1. Shared pieces

- [x] 1.1 Write tests in `tests/auto-cleanup-trigger.test.ts` for `shouldStartAutoCleanup(previous, added, settings)`: 95 plus 10 starts, 100 plus 10 does not, 90 plus 10 starts, a disabled setting, an interval of 0, -1 and 1.5, and an import-sized jump of 300. Move the two cases of `shouldRunAutomaticProfileCleanup` in `tests/user-profile-learning-confidence.test.ts` onto it and record each moved case for the PR description. Create `src/services/user-profile/auto-cleanup-trigger.ts`. Confirm the tests pass.
- [x] 1.2 Write a test in `tests/ai-cleanup-model.test.ts` that `callAICleanup(prompt, model)` calls the given model and not the registered host model or the external API. Add the optional `model` argument in `src/services/user-profile/ai-cleanup.ts`. Confirm `ai-cleanup.ts` stays under 500 lines.
- [x] 1.3 Extend `tests/ai-cleanup-apply-edits.test.ts`: `applyCleanupEdits` returns `restore` entries, with the original items and the merged item for a merge and the original item for a removal. Skipped changes add no entry. Implement it in `src/services/user-profile/ai-cleanup-apply.ts`. Confirm the existing cases still pass unchanged.
- [x] 1.4 Write tests in `tests/profile-edit-save.test.ts` for `applyToNewestProfile(userId, mutate)`: a good save, a conflict then a good save, three conflicts leave the profile unchanged, and no profile. Create `src/services/user-profile/profile-edit-save.ts`. Move `handleAiCleanupApply` onto it. Confirm `tests/ai-cleanup-handlers.test.ts` passes unchanged.

## 2. Restore record and undo

- [x] 2.1 Write tests in `tests/auto-cleanup-store.test.ts` with a real temporary store: insert, newest open row, mark undone, delete a row, a 31-day-old row is deleted on read, and a second profile's rows do not mix. Create `src/services/user-profile/auto-cleanup-store.ts` with the table `profile_auto_cleanups`.
- [x] 2.2 Write tests in `tests/ai-cleanup-undo.test.ts` for `undoCleanupEdits`: a merge and a removal are restored; items learning added stay; a merge result that learning rewrote is not found and leaves no duplicate; an original that is already in the profile is not added again; one item serves one change; the input is not changed; the counts are right. Create `src/services/user-profile/ai-cleanup-undo.ts`.
- [x] 2.3 Write handler tests in `tests/auto-cleanup-handlers.test.ts` with a real temporary store: undo restores and marks the row; undo with no row says there is nothing to undo; a second undo uses the next older row; a save conflict is tried again at most three times and then leaves the profile and the row as they were. Create `src/services/auto-cleanup-handlers.ts`.
- [x] 2.4 Add tests that an item whose category spelling a save rewrote is still found by undo and by Apply: two pure undo tests, one Apply test and one test with a real save. They failed first. The fix compares the category by `categoryKey` in `profileItemIdentityKey`.

## 3. The run

- [x] 3.1 Write tests in `tests/auto-cleanup.test.ts` with a fake batch caller: every item is sent in a batch of at most 100; every proposed change is applied; a failed batch leaves its items; all batches failing changes nothing and leaves no row; a profile with fewer than 2 items is skipped; a second start in the same process is ignored while one runs; the log holds codes and counts and no item text.
- [x] 3.2 Add tests for the save: learning saves during the run and its items stay; a kept item the model reworded keeps its stored wording; a merge that learning changed is skipped without a duplicate; the row is inserted before the save and deleted when the save fails; a run that applies nothing leaves no row; more than 25% of items changed applies nothing, leaves no row and logs `too-many-changes`.
- [x] 3.3 Create `src/services/user-profile/auto-cleanup.ts` with `startAutoProfileCleanup(userId, options)`, built on `runInBatches`, `applyCleanupEdits` and `applyToNewestProfile`. It does not use the dialog job map. Confirm the 3.1 and 3.2 tests pass.
- [x] 3.4 Add the log reason code `no-provider` to `failureReason`. Test it in `tests/ai-cleanup-batches.test.ts` and in `tests/auto-cleanup.test.ts` (a run with no model fails and logs the code).

## 4. Hosts

- [x] 4.1 Write a test in `tests/opencode-profile-learning-auto-cleanup.test.ts`: a live learning pass that crosses the interval starts one run and does not wait for it; a pass that does not cross starts none; a run that throws does not fail learning. Replace `runAutomaticProfileCleanup` in `src/adapters/opencode/profile-learning.ts` with the shared run. Lower the ceiling for this file in `tests/file-size-ceiling.test.ts`.
- [x] 4.2 Remove `aiCleanupProfile` from `src/services/user-profile/ai-cleanup.ts`, since no production caller is left. Move each case of `tests/ai-cleanup.test.ts` that uses it onto the batch code or the shared run, and record each changed case for the PR description. Confirm no assertion is weaker than before.
- [x] 4.3 Write a test in `tests/pi-profile-auto-cleanup.test.ts`: a Pi learning pass that crosses the interval starts one run with Pi's model; no run starts without a crossing or when the setting is off. Add the call in `src/adapters/pi/profile.ts`.
- [x] 4.4 Move `learnProfile` from `src/importer/claude-hook-api.ts` to `src/importer/claude-profile-learning.ts` with no change to its behaviour. Run the existing Claude Code hook tests to confirm. Lower the ceiling for `claude-hook-api.ts`.
- [x] 4.5 Write a test in `tests/claude-profile-learning-auto-cleanup.test.ts`: a pass that crosses the interval starts one run with the model that learning used; a pass that does not cross, a disabled setting, a refused save and a waiting backoff start none. Add the call in `claude-profile-learning.ts`.
- [x] 4.6 Write `tests/auto-cleanup-callers.test.ts`: only the OpenCode, Pi and Claude Code learning files may import the run, so a history import, a backfill or a catch-up run cannot start it.

## 5. Web API and Profile page

- [x] 5.1 Write route tests in `tests/profile-cleanup-routes.test.ts`: `GET` and `POST .../undo` for auto-cleanup, with the token and the user check of the other routes. Create `src/services/profile-cleanup-routes.ts` for these and the existing `ai-cleanup` routes. Replace the `ai-cleanup` lines in `src/services/web-server.ts` with one call. Confirm `tests/ai-cleanup-routes.test.ts` passes and `web-server.ts` is not longer than 1826 lines.
- [x] 5.2 Write tests in `tests/auto-cleanup-undo-state.test.ts` for the pure module `web/src/lib/components/explorer/auto-cleanup-undo-state.ts`: the button shows only with a row; the confirmation text has the time, merged and removed counts; cancel changes nothing; the result message has restored and not found counts. Create the module.
- [x] 5.3 Create `AutoCleanupUndo.tsx` and its hook in `web/src/hooks/`, add the client calls in `web/src/lib/api.ts`, and show the button in the `ProfileView.tsx` header. Add English, Chinese and Arabic text in `web/src/lib/i18n/translations.ts`. Confirm `bun run check` passes and `ProfileView.tsx` stays under 500 lines.

## 6. Docs and records

- [x] 6.1 Update `docs/configuration.md` for `userProfileAutoCleanupEnabled` and `userProfileAutoCleanupInterval`, `docs/web-ui.md` for the Undo button and the confirmation, and the Pi, OpenCode and Claude Code guides for the automatic cleanup. Grep `docs/` and `README.md` for other text about cleanup that this change makes wrong, and fix each hit.
- [x] 6.2 Write `docs/adr/030-profile-cleanup-runs-on-every-host.md` from `docs/adr/TEMPLATE.md`. It covers the shared run, the restore record, the size limit and the supersession of decision 5 of ADR-029. Add it to `docs/adr/ADR_README.md`. Add a line to the status of ADR-029 that decision 5 is superseded.
- [x] 6.3 Run `openspec validate auto-profile-cleanup-all-hosts --strict` and confirm it passes.

- [x] 6.4 After group 7, update `docs/web-ui-memory.md`, `docs/configuration.md`, `docs/using-memory.md` and ADR-030 for the 500 default and the Memory page controls. Write `docs/tdr/052-profile-item-category-spelling-breaks-matching.md` for the category-spelling finding and add it to `docs/tdr/README.md`.

## 7. Memory page switch and interval

- [x] 7.1 Write tests in `tests/auto-cleanup-settings-state.test.ts` for the pure form rules in `web/src/lib/components/memory/auto-cleanup-settings-state.ts`: 50, 500 and 100000 are accepted; 49, 100001, 2.5, 0, negative and text are refused with a message; the edit for the switch and for the interval; an unchanged value sends nothing. Confirm they fail, then create the module.
- [x] 7.2 Write tests in `tests/global-config-writer.test.ts` and `tests/web-settings-api.test.ts` for `userProfileAutoCleanupEnabled` (boolean only) and `userProfileAutoCleanupInterval` (whole number from 50 to 100000): a valid edit is written with comments and other keys kept, an invalid edit and a stale revision are refused, and the snapshot lists both as editable and global-only. Confirm they fail, then add the keys to `settings-snapshot.ts` and `global-config-writer.ts`.
- [x] 7.3 Change the default interval to 500 in `src/config.ts` and its config template. Update `tests/config.test.ts` for the new default and record the changed case for the PR description. Write a test in `tests/config.test.ts` that a project config cannot override either key, then drop the project values in `initConfig`.
- [x] 7.4 Create `AutoCleanupSettings.tsx` in `web/src/lib/components/memory/` and render it in the Profile learning card. Add English, Chinese and Arabic text in `web/src/lib/i18n/settings.ts`. Confirm `bun run check`, `bun run check` in `web/`, and the translation parity tests pass.

## 8. Integration checks

- [x] 8.1 Run `bun run ci:local` in the worktree and confirm it passes.
- [x] 8.2 Build. Make a scratch home folder, copy the config and a `.backup` of `user-profiles.db` into it, and never copy `.env`. Set a spare `webServerPort` and `userProfileAutoCleanupInterval` of 10. Start the web app from this worktree with `HOME` set to the scratch folder. Teach the profile 10 prompts through the Claude Code hook path. Confirm one automatic cleanup runs, a row exists, and the button shows on the Profile page. Undo on the scratch copy and confirm the counts. Never run it on the real profile.
- [x] 8.3 Read the batch times and the number of changes in the scratch log. Confirm the 25% limit did not stop a normal run. If it did, record the numbers and raise the limit in the spec, the design and the code together.
