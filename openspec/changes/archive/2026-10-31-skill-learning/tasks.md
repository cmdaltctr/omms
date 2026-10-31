# Tasks

## 1. Decision record, security rule and config

- [x] 1.1 Write `docs/adr/036-skill-learning-stores-full-turns-in-skills-db.md` (opt-in full turns, redaction switch, separate store, one shared turn path, external API only, tool output bodies not stored) and add it to `docs/adr/ADR_README.md`; verify that Prettier passes on both files
- [x] 1.2 Add a `skills.db` exception bullet to the Security section of `AGENTS.md` (`CLAUDE.md` links to it). Name `skillLearning`, `skillLearningRedact`, the global-only rule and ADR-036. Update `CONTRIBUTING.md` if it repeats the rule. Verify by reading the rendered section
- [x] 1.3 Add `src/services/skill-learning/skill-config.ts` with normalisation of `skillLearning`, `skillLearningRedact` and `skillFolders`, plus the project-override rule (off only). Wire it into `src/config.ts` and `src/config-template.ts`. Verify with a test file covering defaults, project off, project on ignored, and an invalid folder entry
- [x] 1.4 Document the three keys in `docs/configuration.md`; verify that the defaults in the doc match `skill-config.ts`

## 2. Tool outcomes in the readers

- [x] 2.1 Add `outcome` and `error` (bounded to 2,000 characters) to `CaptureToolCall` in `src/core/host.ts`; verify that `bun run typecheck` passes
- [x] 2.2 OpenCode live reader (`adapters/opencode/conversation.ts`): set the outcome from `state.status` and the error from `state.error`. Verify with a failing test first on a fixture that has one completed and one errored tool part
- [x] 2.3 Pi reader (`pi-conversation.ts`, live and import): confirm the tool-result entry fields from a real Pi session file. Then match results to calls by id and set outcome and error. Verify with a failing test first on a fixture with a failed call
- [x] 2.4 Claude Code reader (`claude-conversation.ts`, live and import): match `tool_result` blocks to `tool_use` by `tool_use_id` and set the outcome from `is_error`. Verify with a failing test first on a transcript fixture
- [x] 2.5 OpenCode import reader (`opencode-reader.ts`): set outcome and error from the stored tool part state. Verify with a failing test first on a database fixture
- [x] 2.6 Add a test that the memory capture prompt text for a fixed work unit is the same with and without the new fields. Confirm it fails when the formatter adds `outcome` to the prompt

## 3. skills.db and the shared turn path

- [x] 3.1 Add `src/services/skill-learning/store.ts` with the schema from design §1, `skill_meta` versioning and cascade deletes. Verify with tests: create, insert a turn, insert the same `turn_key` twice (one row), a read-only `turn_key` lookup, and delete turns while proposals stay
- [x] 3.2 Add `skill-index.ts` (find `SKILL.md` up to four levels deep, name from front matter or folder, 60-second cache) and `skill-detect.ts` (the `tool`, `read` and `command` rules from design §5). Verify with tests for nested folders, duplicate names, `plugin:skill` names and each method
- [x] 3.3 Add `turn-output.ts` (`recordSkillTurn`): settings gate, redaction with `stripPrivateContent`/`isFullyPrivate`/`redactTraceText` when on, skill detection, one transaction, and a log of counts only. Verify with tests: off writes nothing, private prompt skipped, key redacted, redaction off keeps the text, and no turn text in the log record
- [x] 3.4 Add `src/core/turn-outputs.ts` (`handleFinishedTurn`) and use it in place of `captureConversation` at the three live sites (`auto-capture.ts`, `adapters/pi/capture.ts`, `claude-hook-api.ts`). Route each handler's capture-off early return through it with `memories: false`. Verify with a test for each host: the memory result is the same with skills on and off, a capture skip still records, a store failure logs `skill-record-failed` and capture still saves, and a retry keeps one copy
- [x] 3.5 Extend `tests/host-neutral-capture-boundary.test.ts` so `src/core/turn-outputs.ts` imports nothing from `skill-learning` and `src/services/skill-learning/` imports no host SDK or adapter. Add a test that profile learning and memory retrieval never open `skills.db`. Verify that each fails when a forbidden import is added

## 4. Skill turns as a history import target

- [x] 4.1 Add `skipSkills` and `--skip-skills` to `import-args.ts`, and pass it through `run-import.ts`. Verify with parser tests for the terminal and in-session forms
- [x] 4.2 In `importHistorySource`, call `handleFinishedTurn` and run the skills output for every candidate before the ledger, live-captured and dry-run checks, as design §11 describes. Leave the memory ledger untouched for skills-only units. Verify with tests: a ledger-`imported` turn is recorded with no new memory, a live-captured turn is recorded once, a dry run counts `wouldRecord` and `alreadyRecorded` and writes nothing, and the same fixture turn recorded live then imported gives one row on each host
- [x] 4.3 Make the host imports (`importPiHistory`, `importClaudeHistory`, `opencode-import.ts`) run `importHistorySource` when memories or skills are on. Skip model readiness checks for a skills-only run, and report progress with the phase `skill-turns`. Verify with a test that a skills-only run with no provider configured finishes with zero model calls
- [x] 4.4 Pass `skipSkills: !skillLearning` from `auto-backfill.ts`. Verify with a test that backfill records turns only when recording is on
- [x] 4.5 Add **Record past turns** as a grouped skills-only import (all set-up hosts, all projects, no cutoff) and `om-memory-system skills record-past --yes`. Verify with tests: the first run records turns, and a second run adds none and reports them as already present
- [x] 4.6 Document `--skip-skills` and **Record past turns** in `docs/cli.md`, `docs/opencode-history-import.md`, `docs/pi-history-import.md`, `docs/claude-code-history-import.md` and `docs/web-ui-memory.md`. Verify that each documented command runs as written

## 5. Ranking, drafting and apply

- [x] 5.1 Add `ranking.ts`: 30-day counts, failed-turn counts, last use, the **Suggested** rule and **Not in a watched folder**. Verify with tests on seeded turns that match the spec scenarios
- [x] 5.2 Add `createBackoff(waitMs)` to `profile-backoff.ts` and make `profileBackoff` one instance. Move the lease logic into one helper that takes a table name, and keep `CatchUpLease` on it. Verify that the existing profile backoff and catch-up tests pass unchanged, and add a test that a skill failure does not pause profile learning
- [x] 5.3 Load the `typesafe-ai` skill. Then add `drafting.ts`: improvement draft (current file plus up to 20 turns, character budget from design §6), Zod reply schema, line diff, base hash, **No change proposed**, and new-skill ideas (up to 200 compact turns, at most three ideas, drop name clashes) with **Draft skill**. Failure codes come from `profile-failure.ts`. Verify with tests using a stub model: valid, identical and invalid replies, a timeout logging `timeout`, and no API set up
- [x] 5.4 Add `apply.ts`: real-path containment, `SKILL.md` name check, kebab-case new names, stale hash check, `skill_versions` save, `.omms-tmp` then rename, and undo with the written-hash check. Verify with tests: a link outside the folder, a manual edit making it stale, no overwrite on new, undo restores, and undo refuses after an edit
- [x] 5.5 Add skill modes and the automatic review loop (10 new uses and 24 hours, every 10 minutes in the web app, under the skill lease and `skillDraftBackoff`). Verify with a fake-clock test: no review at 9 uses, review and apply at 10 uses after 30 hours, no draft during the 10-minute wait, and a stale file is not written
- [x] 5.6 Write `docs/skill-learning.md` (what is recorded and where, what memories and the profile do not get, redaction, past turns, folders, ranking, drafting cost, modes, undo, deleting turns, the tool and the command) and add it to `docs/README.md`. Verify that each command in the guide runs as written

## 6. Agent tool and terminal command

- [x] 6.1 Add `src/core/skill-operations.ts` with the modes `list`, `ideas`, `draft`, `proposals`, `show`, `apply`, `reject` and `help`, and the recording-off message. Verify with a test for each mode against a temporary store
- [x] 6.2 Add `src/cli/skills-command.ts` (`om-memory-system skills <mode>`, plus `delete-turns --yes` and `record-past --yes`). Logs go to stderr and the result goes to stdout. Verify with CLI tests and update `docs/cli.md`
- [x] 6.3 Register the `skills` tool on OpenCode V1 (`src/index.ts`) and Pi (`src/adapters/pi/extension.ts`). Confirm that V2 picks it up through V1. Verify with the adapter tests and `tests/pi-adapter-boundary.test.ts`
- [x] 6.4 Add `hooks/omms-skills-tool.jsx` and its `hooks/omms-skills-tool.test.ts`, and load it from `hooks/omms.jsx`. Verify with `bash scripts/test-claude-mod.sh`
- [x] 6.5 Update `docs/pi-adapter.md`, `docs/opencode-adapter.md` and `docs/claude-code-adapter.md` with the new tool. Verify that the tool names match the registrations

## 7. Web API

- [x] 7.1 Add routes under `/api/skills`: skills list, one skill, folders, proposals, draft, ideas, apply, reject, undo, mode, store stats, delete turns, and record past turns. Use the existing auth, origin and JSON checks. Verify with route tests, including a cross-origin request being refused
- [x] 7.2 Save `skillLearning`, `skillLearningRedact` and `skillFolders` through the existing safe Settings save flow. Verify with a test that only changed keys are written
- [x] 7.3 Accept `skipSkills` in the web import and preview APIs, and return `wouldRecord` and `alreadyRecorded` in the preview. Verify with route tests

- [x] 7.4 Move the category cleanup routes out of `src/services/web-server.ts` into `src/services/profile-cleanup-routes.ts`, so the skill routes fit under the file's size ceiling and keep the importer behind `web-server.ts`. Verify with `tests/category-cleanup-routes.test.ts`, which passes on the old and new code and fails when the routes are missing

## 8. Web UI

- [x] 8.1 Load the `omms-design` skill. Move the sidebar main nav list out of `AppSidebar.tsx` into its own module with no visual change. Remove the `AppSidebar.tsx` entry from `tests/file-size-ceiling.test.ts` if it drops under 500 lines. Verify with the existing sidebar tests and the file-size test
- [x] 8.2 Add the `skills` view and `/skills` route in `routes.ts`, and the **Skills** sidebar entry with translated labels. Verify with route tests for direct load and reload
- [x] 8.3 Build the Skills page: ranked list with filter and **Suggested** badge, recording-off info callout, **Record past turns** when no turns exist, and watched folders with add and remove. Verify with component tests
- [x] 8.4 Build the skill view and proposals: counts, recent turns, **Draft improvement**, **Find new skill ideas**, **Draft skill** with folder choice, the mode choice with automatic warning and confirmation, line diff, and **Apply**, **Reject** and **Undo** with every state label. Verify with component tests
- [x] 8.5 Add the **Skill learning** Settings card and its `SETTINGS_SECTIONS` entry: both switches, the warning callout, the danger callout with confirmation, **Record past turns** with progress, turn count, file size, and **Delete recorded turns** with a count confirmation. Verify with component tests, and update `docs/web-ui-settings.md` and `docs/web-ui.md`
- [x] 8.6 Add the **Skill turns** checkbox to the Import chat history form (`import-draft.ts` and its form). It is ticked by default when recording is on, and disabled with a settings link when off. The preview shows the turn counts, and progress shows the **Skill turns** phase. Verify with component tests, including an old saved draft with no `skills` field
- [x] 8.7 Do a browser check at 1280 px and 390 px of `/skills`, a skill view, a proposal diff, the settings card and the import form, in light and dark themes. Verify with screenshots saved in the session scratchpad

## 9. Integration

- [x] 9.1 Do a live check on a second web app on another port with a temporary storage path. Turn on recording, run **Record past turns** on a copy of real history, run one live turn on each host, draft one improvement with the external API, apply it, undo it, and delete turns. Verify that `omms.log` holds no turn text and that memories and the profile did not change from the past-turns run
- [x] 9.2 Run `bun run ci:local`, `bash scripts/test-claude-mod.sh` and `openspec validate skill-learning --strict`, and verify that all pass
- [x] 9.3 Run `graphify update .` and verify that it finishes without error

## 10. Final ADR and docs pass

- [x] 10.1 Update ADR-036 to match what was built: set Status to Accepted, record the turn_key rule (OpenCode live uses the message id), the separate `path` field that keeps memory capture input unchanged, and the known gaps (OpenCode live prompts already stripped, `chatMessage.enabled` off records nothing). Point its change link at the archive path. Verify Prettier passes and the link resolves after archive
- [x] 10.2 Re-read every guide this change touched (`docs/skill-learning.md`, `configuration.md`, `cli.md`, the three import guides, `web-ui-memory.md`, `web-ui-settings.md`, `web-ui.md`, the three adapter guides) against the final code and UI. Fix any drift, check `docs/README.md` lists `skill-learning.md`, and confirm `AGENTS.md` and `CONTRIBUTING.md` agree. Verify with Prettier and by running each documented command once

## 11. Ranking: attributed failures and attention order

- [x] 11.1 Record the tool-call position of each skill use (`skill_uses.position`, -1 for a slash command), with an ALTER for an older dev `skills.db`. Tests: `skill-learning-detect`, `skill-learning-store`
- [x] 11.2 Count a failed turn only for tool calls after the earliest use of the skill in the turn. Test: `skill-learning-ranking`
- [x] 11.3 Add the attention score (F + 1) / (U + 2), `SUGGEST_MIN_ATTENTION` 0.3 and the attention order to `rankSkills`. Test: `skill-learning-ranking`
- [x] 11.4 Expose `order` in `GET /api/skills`, `skills list --order`, the `skills` tool schemas and the Claude Code tool. Tests: `web-skill-routes`, `skill-operations`, `skills-record-past`, `opencode-skills-tool`, `hooks/omms-skills-tool.test.ts`
- [x] 11.5 Add the sort choice and the attention meta to the Skills page. Test: `web/tests/skills-components.spec.tsx`
- [x] 11.6 Update the specs, `design.md`, `docs/skill-learning.md` and `docs/cli.md`; run `openspec validate skill-learning --strict`

## 12. Verification fixes

- [x] 12.1 Watch a linked skill folder once: de-duplicate watched folders by real path (`skill-folders.ts` `watchedSkillFolders`, used by `settings-for.ts` and `web-review.ts`), and index entries by the real path of each `SKILL.md`. A read through the linked spelling matches the indexed file. Tests: `skill-learning-detect`, `skill-learning-ranking`, `skill-config`, `skill-learning-storage-path`
- [x] 12.2 Read the config at the start of each automatic review tick: `web-jobs.ts` passes `() => CONFIG`, and `webReviewDeps` calls it each tick. Tests: `skill-learning-web-review`, `skill-learning-web-jobs`
- [x] 12.3 Record `agent` for Claude Code applies: hidden `skills apply --applied-by agent` (only `agent`), passed by `hooks/omms-skills-tool.jsx`. Update `docs/claude-code-adapter.md`. Tests: `skill-learning-cli`, `hooks/omms-skills-tool.test.ts`
- [x] 12.4 Add **Recent proposals** to the Skills page: the 20 most recently changed proposals that are not pending, folded, with state and Undo. Translate the heading. Tests: `web/tests/skills-components.spec.tsx`, `web/tests/skills-model.spec.ts`
- [x] 12.5 Update `design.md` to describe what was built
- [x] 12.6 Keep `skills.db` in the global storage path when a project config sets `storagePath` (`CONFIG.skillStoragePath`, `skillStoragePath()`, connection manager allows both roots). Update `docs/configuration.md`. Test: `skill-learning-storage-path`
- [x] 12.7 Let the agent fix a skill with no external API call: `evidence`, `propose` and `undo` modes in the shared operations, the Pi, OpenCode, V2 and Claude Code tools, and `skills evidence|propose|undo` (`--content-file`, `-` for standard input). `drafted_by` on proposals. Update the spec, `design.md` §8, `docs/skill-learning.md`, `docs/cli.md` and the three adapter guides. Tests: `skill-learning-agent-fix`, `skill-learning-agent-hosts`, `skill-learning-cli`, `opencode-skills-tool`, `pi-extension`, `hooks/omms-skills-tool.test.ts`

## Workflow follow-up

- Run `openspec-verify-change`, then archive the change before the pull request.
