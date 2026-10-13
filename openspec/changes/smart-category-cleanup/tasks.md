# Tasks

## 1. Grouping (pure module)

- [ ] 1.1 Write `tests/category-groups.test.ts` for grouping with hand-made vectors: two close labels form one group; a preference label and a pattern label form one group; a label far from all others joins no group; `explicit` never joins a group; average linkage keeps A and C apart when A is close to B, B close to C, and A far from C; groups list each label with its item count; group ids are stable for the same input. Verify the tests fail because the module does not exist.
- [ ] 1.2 Add `src/services/user-profile/category-groups.ts` (pure, no config import; threshold passed in, default constant 0.80). Verify task 1.1 passes.

## 2. Model check and naming

- [ ] 2.1 Write tests with a fake model port: a reply that removes a stray label shrinks the group; a group left with one label is dropped; a reply naming a label outside the group is ignored; a failed or timed-out call gives the most used label as the name and marks the group not checked; groups go 20 per call; the prompt holds names, counts and at most three example descriptions per name; the log holds counts and outcome codes only. Verify they fail.
- [ ] 2.2 Add the check and naming step to `src/services/user-profile/category-cleanup.ts`, reusing the AI cleanup's model resolution and `EXTERNAL_PROFILE_CLEANUP_TIMEOUT_MS`. Verify task 2.1 passes.

## 3. Preview, apply and undo service

- [ ] 3.1 Write tests: building a preview leaves the stored profile and its version unchanged and returns the version, groups and before and after counts; apply with accepted ids renames only those items, keeps every description, evidence, frequency, confidence and vector, keeps the item count, writes one changelog entry starting `Category cleanup:`, and honours an edited name after tidying; apply with an old version is refused and changes nothing. Verify they fail.
- [ ] 3.2 Add an optional expected version to `updateProfile` that refuses the save when the stored version differs. Write its test first. Verify existing `updateProfile` tests still pass.
- [ ] 3.3 Implement preview and apply in the service. Verify task 3.1 passes.
- [ ] 3.4 Write undo tests: after a cleanup of 12 items, learning merges 2 away and adds 5, undo restores 10, reports 10 restored and 2 not found, and leaves the 5 new items unchanged; undo with no cleanup reports nothing to undo and writes no changelog entry; a second undo targets the next older cleanup that is not undone. Verify they fail.
- [ ] 3.5 Add the `profile_category_cleanups` table (created on first use) and undo matching by section, description SHA-256 and new category. Verify task 3.4 passes, and that the table holds no description text.

## 4. Surfaces

- [ ] 4.1 Web API: preview, apply and undo endpoints beside `/api/user-profile/ai-cleanup`, with handler tests for success, a refused stale apply, and nothing to undo. Verify the tests pass.
- [ ] 4.2 CLI `om-memory-system profile-cleanup-categories`: preview by default, `--yes` applies every group, `--undo`, `--help`; unknown options refused. Tests modelled on `tests/profile-normalise-categories-command.test.ts`. Verify they pass and that a preview leaves the store unchanged.
- [ ] 4.3 Web: a Clean up categories button with the current category count on the Profile page, and a review dialog modelled on `AiCleanupDialog` (labels with counts, editable name, accept switch, not-checked mark, before and after counts, the merge note, an Undo last cleanup action). Strings in English, Chinese and Arabic. Verify with `bun run typecheck`, `bun run build`, and a browser check of the dialog at desktop and mobile widths.
- [ ] 4.4 Docs: `docs/cli.md` (command), `docs/using-memory.md` (how categories are cleaned up and what the merge note means), `docs/web-ui.md` (Profile page button and dialog). Verify `bun run format:check` passes on them.

## 5. Verification

- [ ] 5.1 `bun run ci:local` passes in this worktree.
- [ ] 5.2 Run a preview (no apply) on the live profile. Record in a new TDR: the number of groups, the categories before and after if every group were accepted, the share of groups the model changed, and the run time. Show the operator a sample of groups before any live apply; apply on the live profile only with operator approval.
- [ ] 5.3 `openspec validate smart-category-cleanup --strict` passes.
