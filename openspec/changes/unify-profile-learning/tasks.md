# Tasks: unify profile learning

Work in the worktree `omms-feat-unify-profile-learning` only. Use `feat:` commits. Run each test file through `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. A plain `bun test` refuses to run.

Slices A, B and G own separate files and can run as parallel subagents after group 2. Slice C needs A and B. Slices D, E and F need C and can run in parallel. Each slice touches 15 files or fewer, tests and docs included.

## 1. Start and characterise what stays

- [x] 1.1 Run `git rev-parse --show-toplevel`, `git branch --show-current` and `git worktree list`. Confirm the worktree and branch. Run `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)`. Verify: both installs exit 0.
- [x] 1.2 Measure again: line counts of `config.ts`, `claude-hook-api.ts`, `src/adapters/opencode/profile-learning.ts`, and the ratchet counts of `user-prompt-manager.ts`. Update the Context section of `design.md` if a number moved. Verify: the table matches the measured numbers.
- [x] 1.3 Add characterisation tests for behaviour that stays, against today's code, in `tests/profile-learning-characterisation.test.ts`: the reply schema check (Pi, Claude Code), the UTF-8 byte cut and marker (OpenCode), three save attempts with no second model call (all hosts), newest-first batch, trivial prompts skipped, cleanup started when the interval is crossed, the category list in the system prompt, and the 10-minute wait after a failure. Verify: each test passes, and fails after a one-line mutation of the code it covers. Record each mutation in the test file comment.

## 2. Failing tests for behaviour that changes

- [x] 2.1 Add `tests/profile-learning-pass.test.ts` with one test per changed default, parameterised over `pi`, `opencode` and `claude-code` where the spec names all hosts: no email learns into `unknown`; no decay by default; full model input by default; validation task when the setting is on (Pi, Claude Code); history text "<Host> analysis of N prompts"; notice "Analysed N prompts and updated your profile"; OpenCode fallback notice; malformed external reply on OpenCode fails with `invalid-reply`; Pi waits 10 minutes after three save conflicts; Claude Code learns during a catch-up run. Verify: every test fails on today's code for the stated reason (missing module or old behaviour), not for a typo.
- [x] 2.2 Add `tests/profile-learning-claims.test.ts`: a claimed prompt is not taken by a second pass; a failed pass releases its claim; a claim older than 10 minutes is free; `drainProfileBacklog` and a live pass never take the same prompt. Verify: the tests fail on today's code.
- [x] 2.3 Add `tests/profile-learning-settings.test.ts`: defaults, invalid values reported with key and accepted values, project values ignored with a log line, and the writer accepts `null` for the six keys. Verify: the tests fail on today's code.

## 3. Slice A: settings and config wiring

Files: `src/core/profile-learning/settings.ts`, `src/config.ts`, `src/config-template.ts`, `src/services/settings-editable-keys.ts`, `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`, `tests/profile-learning-settings.test.ts`, `docs/configuration.md`.

- [x] 3.1 Create `src/core/profile-learning/settings.ts` with the keys, defaults, parser, project-override removal and edit checks (design D6). No `CONFIG` import. Verify: `tests/profile-learning-settings.test.ts` parser cases pass.
- [x] 3.2 Wire it into `config.ts` and `config-template.ts`. Make `userProfileValidationEnabled` and `showUserProfileToasts` global only. Verify: `tests/file-size-ceiling.test.ts` passes (`config.ts` at or below 927 lines) and the project-override test passes.
- [x] 3.3 Add the six keys to `PAGE_KEYS`, the snapshot `globalOnly` list, `isValidEdit` and `RESETTABLE_KEYS`. Verify: the writer tests in 2.3 pass, and `tests/settings-catalogue-defaults.test.ts` passes once slice G adds the catalogue rows.
- [x] 3.4 Document the four new keys and the two global-only keys in `docs/configuration.md`. Verify: `grep -n userProfileWithoutEmail docs/configuration.md` finds the entry, and Prettier passes on the file.

## 4. Slice B: batch claims

Files: `src/services/user-prompt/user-prompt-manager.ts`, `src/importer/profile-backlog.ts`, `src/importer/profile-import.ts`, `tests/profile-learning-claims.test.ts`, the existing `user-prompt-manager` tests.

- [x] 4.1 Add the `user_learning_claimed_at` column through the existing column list. Change `getPromptsForUserLearning` to claim with `UPDATE … RETURNING`, clear the claim in `markMultipleAsUserLearningCaptured`, and change `markForUserLearning` to take a list and clear the claim (design D5). Verify: `tests/modularity-ratchets.test.ts` passes with no raised baseline, and the store-level cases of 2.2 pass.
- [x] 4.2 Make `drainProfileBacklog` claim its batch and release it on failure. Update the `profile-import.ts` caller of `markForUserLearning`. Verify: 2.2 passes in full, and the catch-up and import tests pass unchanged.

## 5. Slice C: the shared pass

Files: `src/core/profile-learning/model-input.ts`, `validation.ts`, `fallback.ts`, `pass.ts`, `src/core/profile-analysis.ts`, `src/services/user-profile/merge-and-save.ts`, `tests/profile-learning-pass.test.ts`, `tests/profile-learning-characterisation.test.ts`, `tests/profile-workflow-prompt.test.ts`, `tests/profile-category-prompt.test.ts`, `tests/user-profile-learning-confidence.test.ts`, `docs/using-memory.md`, `docs/shared-core.md`, `docs/adr/052-one-profile-learning-pass-for-every-host.md`, `docs/adr/ADR_README.md`.

- [ ] 5.1 Move the full input builder and the byte cut to `model-input.ts`, and add the prompts-only input. Point `profile-workflow-prompt` and `profile-category-prompt` tests at it. Verify: the byte-cut characterisation tests pass against the new module with no assertion changed.
- [ ] 5.2 Move the validation task and `applyValidations` to `validation.ts`. Verify: the validation cases of 2.1 pass.
- [ ] 5.3 Make `analyzeProfile` use `completeStructured` when present and check every reply. Drop the `pi ` prefix from its texts. Verify: `tests/pi-profile.test.ts` passes, and `profileFailureCode` still returns `timeout` and `invalid-reply` for the new texts.
- [ ] 5.4 Add optional decay and validation hooks to `saveMergedProfile`, applied on every attempt. Verify: the conflict characterisation tests pass, and the decay-on case re-applies decay on each retry.
- [ ] 5.5 Add `fallback.ts` with the shared fallback notice (design D3). Verify: the OpenCode fallback case of 2.1 passes against the port.
- [ ] 5.6 Write `pass.ts` (design D1): email rule, decay, input, model call, save, mark, cleanup, notice, backoff, catch-up rule, claims. Verify: every case in 2.1 and 2.2 passes when driven through `runProfileLearningPass` with fake stores, and `tests/host-branch-boundary.test.ts` and `tests/modularity-ratchets.test.ts` pass.
- [ ] 5.7 Replace `createUserProfileToolSchema` in the confidence test with the shared schema check. Verify: the out-of-range confidence case still fails validation.
- [ ] 5.8 Update `docs/using-memory.md` (how learning behaves, the six settings) and `docs/shared-core.md` (the new folder and ports). Write ADR-052 and add it to `docs/adr/ADR_README.md`. Verify: Prettier passes on the four files and every link resolves.

## 6. Slice D: OpenCode on the shared pass

Files: `src/adapters/opencode/profile-model.ts`, `src/adapters/opencode/profile-learning.ts`, `src/v2/plugin.ts`, `tests/file-size-ceiling.test.ts`, `tests/opencode-profile-learning-*.test.ts`, `tests/user-profile-learning-error.test.ts`, `tests/memory-limits-operation-snapshot.test.ts`, `tests/auto-cleanup-callers.test.ts`, a new `tests/opencode-profile-learning-v2.test.ts`, `docs/opencode-adapter.md`.

- [ ] 6.1 Add the OpenCode model port with structured output and the shared fallback. Verify: a port test shows one `generateStructuredOutput` call with a 120 s limit, and the fallback notice on failure.
- [ ] 6.2 Reduce `profile-learning.ts` to the trigger: refresh config, then call the pass with host `opencode`, the port, `showOpencodeNotice` and the cleanup start. Delete `buildLearningPaths` and the old loop. Remove its entry from `tests/file-size-ceiling.test.ts`. Verify: the file is under 100 lines and the ceiling test passes.
- [ ] 6.3 Add `tests/opencode-profile-learning-v2.test.ts`: V2 `setup` with a fake V2 context, an idle event, one pass with host `opencode`. Verify: the test fails when the trigger is removed.
- [ ] 6.4 Move the old OpenCode subprocess tests to shared-pass tests, or delete a test only when 1.3 or 2.1 covers the same assertion. Change only the assertions listed in design D9, each with a comment naming the user decision. Verify: `grep -rn "Bun.spawn" tests/opencode-profile-learning-*.test.ts` finds no learning subprocess, and every test passes.
- [ ] 6.5 Update `docs/opencode-adapter.md`. Verify: Prettier passes.

## 7. Slice E: Pi on the shared pass

Files: `src/adapters/pi/profile.ts`, `src/adapters/pi/extension.ts`, `src/adapters/pi/live-model.ts`, a new `src/adapters/pi/user-prompt.ts`, `tests/pi-profile-auto-cleanup.test.ts`, `tests/pi-profile-failure.test.ts`, a new `tests/pi-prompt-record.test.ts`, `docs/pi-adapter.md`.

- [ ] 7.1 Add `recordPiPrompt` (design D4) and call it after each settled turn. Verify: `tests/pi-prompt-record.test.ts` shows `<private>` removed, a fully private prompt not saved, the prompt marked captured, and no second row after a Pi history import of the same session.
- [ ] 7.2 Replace the in-memory batch and `performPiProfileLearning` with a call to the pass (host `pi`, `liveModels.profile` through the shared fallback, `notify(ctx)`). Verify: the restart scenario (6 prompts, restart, 4 prompts) learns 10, and the Pi cases of 2.1 pass.
- [ ] 7.3 Update the Pi auto-cleanup and failure tests to the pass. Change only the no-email assertion. Verify: both files pass.
- [ ] 7.4 Update `docs/pi-adapter.md`: remove the "not ported" limitation and describe prompt recording. Verify: Prettier passes.

## 8. Slice F: Claude Code on the shared pass

Files: `src/importer/claude-profile-learning.ts`, `src/importer/claude-hook-notices.ts`, `src/importer/claude-hook-api.ts`, `src/adapters/claude-code/hook-client.ts`, `tests/claude-profile-learning-auto-cleanup.test.ts`, `tests/claude-hook-client.test.ts`, a new `tests/claude-profile-notice.test.ts`, `hooks/*.test.ts` if a hook module reads the reply, `docs/claude-code-adapter.md`.

- [ ] 8.1 Reduce `learnClaudeProfile` to a call to the pass with host `claude-code`, the external model and a `notify` that sets the pending line. Remove the `CatchUpLease` check (the pass applies the catch-up setting). Verify: the Claude cases of 2.1 pass and `claude-hook-api.ts` stays at or below 525 lines.
- [ ] 8.2 Add the pending profile line to `claude-hook-notices.ts` and to the `session-start` and `user-prompt-submit` answers for hooks that ask (design D8). Verify: `tests/claude-profile-notice.test.ts` covers the next prompt, two passes, notices off, a subagent hook, and confirmation.
- [ ] 8.3 Make `hook-client.ts` ask for user lines on `user-prompt-submit` and write `systemMessage` for it. Verify: `tests/claude-hook-client.test.ts` shows one JSON line on stdout with `systemMessage` and `additionalContext`, and nothing else. Run `bash scripts/test-claude-mod.sh` if a `hooks/` module changed.
- [ ] 8.4 Update `docs/claude-code-adapter.md` (profile learning section). Verify: Prettier passes.

## 9. Slice G: the Memory page table

Files: `web/src/lib/profile-learning-controls.ts`, `web/src/lib/components/memory/ProfileLearningSettingsSection.tsx`, `web/src/lib/components/memory/SharedView.tsx`, `web/src/lib/components/memory/shared-summary.ts`, `web/src/lib/settings-catalogue-memory.ts`, `web/src/lib/i18n/settings-catalogue-memory-rows.ts`, `web/src/lib/i18n/settings.ts`, `web/tests/profile-learning-controls.spec.ts`, `web/tests/profile-learning-section.spec.tsx`, `web/tests/shared-view.spec.tsx`, `docs/web-ui-memory.md`.

- [x] 9.1 Load the `omms-design` skill. Write the pure option lists and save edits in `profile-learning-controls.ts`, with tests first. Verify: `web/tests/profile-learning-controls.spec.ts` checks every option list against the spec and fails when an option is added.
- [x] 9.2 Add the six catalogue rows (anchor `shared-profile`) and the Chinese and Arabic pairs. Verify: `web/tests/settings-catalogue.spec.ts` passes.
- [x] 9.3 Build `ProfileLearningSettingsSection` after the `KeywordModeSection` pattern: six `SettingRow` dropdowns, four fixed rows, Save, Cancel, **Reset to default** with `SettingsConfirmDialog`, status line, read-only rule. Mount it in the `shared-profile` row. Update the profile summary line. Verify: `web/tests/profile-learning-section.spec.tsx` covers save, cancel, reset, reset off with no saved key, conflict reload and read-only; `web/tests/shared-view.spec.tsx` passes.
- [x] 9.4 Update `docs/web-ui-memory.md` (Profile learning section). Verify: Prettier passes and `bun --cwd web run check` passes.

## 10. Integration and close

- [ ] 10.1 Run `graphify update .`. Run `bun run check`, then `bun run ci:local`. Verify: read the real last line of the `ci:local` output; it reports success. Report any failure with the command and its output.
- [ ] 10.2 Live browser check of `/memory/shared` on a free port with a scratch HOME. Never use the real `~/.omms`, never port 4747. Steps: check the port with `lsof -iTCP:<port> -sTCP:LISTEN`; build; start the web app with `HOME=<scratch>`; open the Profile learning row with `chrome-devtools` (or `orca-cli` if Chrome fails). Change two dropdowns, save, and confirm the scratch global config holds the two keys. Press **Reset to default** and confirm the keys are gone. Check 390 px width, dark mode and Arabic. Verify: screenshots in the scratchpad, and the config file contents before and after.
- [ ] 10.3 Run `/opsx:verify` (`openspec-verify-change`) and `openspec validate unify-profile-learning --strict`. Verify: no open findings and the validate line says the change is valid.
- [ ] 10.4 Mark tasks 2.2 to 2.4 of `modularity-follow-ups` as done by this change, with a note that names this change. Verify: `openspec status --change modularity-follow-ups` shows them ticked.

## Workflow follow-up

- Archive this change with `openspec-archive-change` before the pull request is created, in the same pull request.
- Ask the user before commit and push. Open one pull request to `main` and wait for the user's word to merge.
