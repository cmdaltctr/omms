# Tasks

## 1. Reproduce and fix the stale apply

- [x] 1.1 In `tests/category-cleanup-service.test.ts`, add a regression test: build a preview, save a new profile version through the manager, then apply. Run it with `bash scripts/run-tests-isolated.sh tests/category-cleanup-service.test.ts` and confirm it fails with `stale` on current code.
- [x] 1.2 Add tests for the other two new scenarios: learning added an item with an accepted label (renamed too), and every item of an accepted label gone (`renamed: 0`, no changelog entry). Confirm both pass once 1.3 is done.
- [x] 1.3 In `applyCategoryCleanup`, remove the version comparison and the `version` input, and save with `profile.version` read in the same call. Remove `version` from `CategoryCleanupPreview`. Confirm 1.1 and 1.2 pass.
- [x] 1.4 Add a test where a save lands between read and write (stub the manager so `updateProfile` returns `false`). Confirm apply returns `stale`.

## 2. API, web app and CLI

- [x] 2.1 In `handleCategoryCleanupApply`, change the `stale` message to "Profile saved at the same moment. Try Apply again." Update the stale test in `tests/category-cleanup-api.test.ts` (it sends `version: 999`) so it covers the write race, and drop `version` from the request in the success test.
- [x] 2.2 In `CategoryCleanupDialog.tsx`, stop sending `version` and remove it from the `CleanupPreview` type. Run `bun run check` in the worktree and confirm it passes.
- [x] 2.3 In `src/cli/profile-cleanup-categories-command.ts`, stop passing the version to apply. Run its test file and confirm it passes.

## 3. Documentation and gate

- [x] 3.1 In `docs/using-memory.md` and `docs/cli.md`, state that Apply works on the current profile even when learning ran during the preview. Check with `grep -n "preview" docs/using-memory.md docs/cli.md` that no text still says the profile must be unchanged.
- [x] 3.2 Write TDR-047 in `docs/tdr/` (symptom, cause: 30 minute preview against 5 minute learning, fix) and add it to `docs/tdr/README.md`.
- [x] 3.3 Run `openspec validate fix-cleanup-apply-after-learning --strict`, then `bun run ci:local` in the worktree. Both must pass.
