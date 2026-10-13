# Tasks

## 1. Reproduce

- [x] 1.1 Run `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)` in this worktree. Verify: `bash scripts/run-tests-isolated.sh tests/profile-write.test.ts` runs. New merge tests go in a new file, `tests/profile-workflow-merge.test.ts`, modelled on `tests/user-profile-cold-buffer-isolation.test.ts`.
- [x] 1.2 Write a test that merges 3 unrelated workflows (similarity between 0.5 and 0.8) into a profile. Expect 3 entries. Verify the test fails on current code with 1 entry.
- [x] 1.3 Write a test for a match that carries fewer steps than the stored workflow. Expect the stored steps to stay. Verify it fails on current code.
- [x] 1.4 Read `deduplicateItems` and `detectConflicts`. Dedup merges a pair only when the model confirms a duplicate (5 calls per pass), so no change is needed. Recorded in `design.md` and TDR-040. Verify: no test needed, because it needs a live model.

## 2. Analysis prompt and step filter

- [x] 2.1 Write a test that `mergeProfileData` drops workflows with fewer than 3 non-empty steps and keeps preferences and patterns. Verify it fails on current code.
- [x] 2.2 Add `WORKFLOW_PROMPT_RULES`, `MIN_WORKFLOW_STEPS`, and `hasEnoughWorkflowSteps` to `src/core/extraction.ts`. Use the rules in the three profile prompts and the filter in `mergeProfileData`. Verify test 2.1 passes.
- [x] 2.3 Write tests that the analysis prompt and both OpenCode prompts contain the rules. Verify they fail when the rules are removed.

- [x] 2.4 Warm the embedding service in the terminal import branch of `src/cli/index.ts`. Write `tests/cli-import-warmup.test.ts` first. Verify two of its four tests fail before the change and all four pass after.

- [x] 2.5 Warm the embedding service in `src/cli/profile-catch-up-command.ts` after the model is selected. Add 3 tests to `tests/profile-catch-up-command.test.ts`. Verify two fail before the change and all 9 pass after.

## 3. Workflow merge rules

- [x] 3.1 In `mergeItems`, make workflows use the strong band only and skip the neighbour-fold pass. Verify tests 1.2 and the strong-match scenario pass.
- [x] 3.2 In `mergeConfirmedMatch`, replace steps only with a longer list. Verify test 1.3 passes.
- [x] 3.3 Skip `evolveDescription` for workflows. Write a test at the frequency-5 milestone that the description stays, and a control test that a preference is still rewritten. Verify it fails on current code, then passes.
- [x] 3.4 Confirm preferences and patterns tests are unchanged and pass.

## 4. Documentation and gate

- [x] 4.1 Update the profile guide in `docs/` with the workflow rules.
- [x] 4.2 Add a TDR in `docs/tdr/` for the undefined-category finding and add it to the folder index.
- [x] 4.3 Run `openspec validate fix-workflow-merging --strict`. Verify no findings.
- [x] 4.4 Run `bun run ci:local`. Verify it passes.

## 5. Rebuild the live profile (after the fix is installed)

- [x] 5.1 Take a snapshot of `~/.omms/data/user-profiles.db` with `sqlite3 .backup`. Remove the workflow with frequency 518 from the active profile. Verify the profile has 4 workflows.
- [x] 5.2 Run `import-pi-history` and `import-claude-history` with `--scope all-projects --force --skip-memories`. Verify exit code 0 and 0 failed batches. First attempt (12:04 to 12:19 on 2026-10-09) exited 0 but ran with a cold embedding service, so most findings were held back or dropped. Redone as 5.5.
      Result of the rerun (2026-10-09, 12:25 to 17:14): Pi 28 batches and Claude Code 24 batches, both exit 0, 0 failed. 59 of 59 workflow, preference and pattern merges ran with the embedding service warm. The batch took about 4 minutes warm against about 20 seconds cold.
- [x] 5.3 Count workflows in the active profile. Verify the count is above 5 and that no workflow has a frequency above 50. Result: 137 workflows, highest frequency 27, none with fewer than 3 steps. If it fails, report the counts and stop.
- [x] 5.4 Run a dry run of `import-opencode-history --scope all-projects`. Ask the user before the forced OpenCode run. Result: dry run read 428 of 452 sessions in 16 seconds and found 2,449 profile prompts waiting (about 49 batches, an estimated 4 to 5 hours warm). The user deferred the forced run until after `normalise-profile-categories`. It is tracked there as task 7.5.
- [x] 5.5 Rebuild the project (`bun run build`), delete the `#profile-rebuild` ledger rows for Pi and Claude Code after a `sqlite3 .backup` of `import-ledger.db`, then rerun task 5.2 with the fixed build. Verify the log shows `embeddingReady":true` for every workflow merge, and then apply the checks of 5.3.
