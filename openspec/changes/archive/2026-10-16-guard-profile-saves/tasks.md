# Tasks

## 1. Required version on every save

- [x] 1.1 Write a failing test in `tests/profile-save-guard.test.ts`: two writers read version 40; the second save SHALL fail and leave version 41. Confirm it fails on the current code because the second save passes no version.
- [x] 1.2 Make `expectedVersion` required in `updateProfile` and in `ProfileAdminStore.updateProfile`. Verify with `bun run typecheck` that each of the 14 save points now fails to compile until it passes a version.
- [x] 1.3 Pass the read version at the simple save points: decay, AI cleanup apply and item edit in `api-handlers.ts`, `profile-admin.ts`, the normalise command, OpenCode automatic cleanup and learning paths. Background steps log `profile save skipped: version changed` with the item type only. Verify with the 1.1 test, `tests/ai-cleanup-apply.test.ts` and `tests/profile-admin.test.ts`, and a new decay test that shows a skipped save.
- [x] 1.4 Update test fakes that implement `updateProfile` to the new signature. Verify with `bun run typecheck`.

## 2. Learning merges again after a conflict

- [x] 2.1 Write a failing regression test for 13 October: learning reads the profile, a category cleanup renames items, then learning saves. The renamed items SHALL keep their new categories, and the analysis model SHALL be called once. Run it through the Claude Code learning path. Confirm it fails on the current code.
- [x] 2.2 Add the shared merge-and-save helper in `src/services/user-profile/`: reload, merge the same raw result, save with the fresh version, at most three attempts, no import of `src/config.ts`. Unit-test success on attempt 2 and failure after attempt 3.
- [x] 2.3 Use the helper in `claude-hook-api.ts`, `profile-backlog.ts`, `pi/profile.ts` and the `memory` tool's profile add in `memory-operations.ts`. Verify with the 2.1 test, `tests/claude-hook-api.test.ts`, `tests/profile-backlog.test.ts` and `tests/pi-profile.test.ts`. Add a test that the batch prompts stay unanalysed after three failed attempts.
- [x] 2.4 Pass `existingProfile.version` in the OpenCode learning retry loop. Add a test that a conflict on the first save leads to a re-merge and a saved profile with the cleanup's categories.
- [x] 2.5 For each new test in groups 1 and 2, break the code under test, confirm the test fails, then restore the code.

## 3. Cleanup dialog starts unchecked groups unticked

- [x] 3.1 Write a failing test in `web/tests/` that a preview with checked and unchecked groups starts with only the checked groups accepted, and that the "after" count follows them.
- [x] 3.2 Change `CategoryCleanupDialog.show()` to accept only checked groups. Verify with the 3.1 test and a test that ticking an unchecked group includes it in the apply request.
- [x] 3.3 Update the cleanup section of `docs/web-ui.md`: unchecked groups start unticked. Verify in the browser with the fake-data preview at 390 px and desktop width.

## 4. Records

- [x] 4.1 Write `docs/tdr/050-profile-saves-lost-to-stale-learning-copy.md` with the 13 October timeline and the fix. Add it to `docs/tdr/README.md`.
- [x] 4.2 Write `docs/adr/028-every-profile-save-checks-version.md`. Add it to the ADR index.
- [x] 4.3 Add a dated note to TDR-044 with the 16 October recount and a link to TDR-050. TDR-047 is Accepted, so TDR-050 records the correction to its "cannot overwrite" sentence instead of an edit.
- [x] 4.4 When groups 1 to 3 are done, set TDR-050 and ADR-028 to Accepted and update both indexes.

## 5. Integration

- [x] 5.1 Run `bun run ci:local` in the worktree and confirm it passes.
- [x] 5.2 Run `openspec validate guard-profile-saves --strict` and the `openspec-verify-change` skill.
