# Tasks

## 1. Measure and store

- [x] 1.1 Add phase durations (embed, group, check, in milliseconds) and counts of groups reused and sent to the `category cleanup: preview built` log record. Verify with a focused test that the record holds those keys and no label text.
- [x] 1.2 In `category-cleanup-store.ts`, add the `profile_category_verdicts` table with `saveVerdicts`, `loadVerdicts`, and `pruneVerdicts(profileId, currentGroupIds, maxAgeMs)`. Verify with a test file against a temporary store: save, load, replace on the same key, prune by missing id, prune by age.

## 2. Reuse in the preview

- [x] 2.1 Write failing tests in `tests/category-cleanup-naming.test.ts` for the scenarios "A rebuild after learning", "Retry only what failed", "A changed label set", "A saved drop" and "Progress of a rebuild", using a stub model that counts the groups it receives. Confirm they fail on current code.
- [x] 2.2 Change `checkAndNameGroups` to take the saved verdicts, skip groups that have one, run saved answers through `applyReply`, send the rest in batches, and save each answered group (including drops) right after its batch. Fallback results save nothing. Confirm the 2.1 tests pass.
- [x] 2.3 In `previewCategoryCleanup`, load verdicts for the profile, call prune after grouping, and pass both to `checkAndNameGroups`. Add tests for "A crash during a preview" (a stub model that throws on batch 2, then a second preview) and "Expiry" (a verdict stored with an old `created_at`). Confirm both pass.
- [x] 2.4 Confirm `tests/category-cleanup-job.test.ts` and `tests/category-cleanup-api.test.ts` still pass, and that the web progress text reads correctly when the batch total is 0 (open the dialog against a profile with every verdict saved).

## 3. Documentation and gate

- [x] 3.1 In `docs/using-memory.md` and `docs/cli.md`, add that a new preview reuses earlier model answers, retries only unchecked groups, and keeps them 30 days. Replace the "about 27 minutes in all" sentence with "the first preview; later previews only check new groups". Verify with `grep -n "27 minutes" docs/cli.md`.
- [x] 3.2 Write TDR-048 in `docs/tdr/` (symptom, the group-id key, why prompt text was rejected) and add it to `docs/tdr/README.md`.
- [x] 3.3 Run `openspec validate resumable-category-cleanup-preview --strict`, then `bun run ci:local` in the worktree. Both must pass.
