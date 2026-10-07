## 1. Workflow retention

- [x] 1.1 Add the four decay scenarios from the spec to `tests/user-profile-decay.test.ts`; confirm the two workflow-keep scenarios fail on current code.
- [x] 1.2 Add `userProfileWorkflowStaleDays` to `src/config.ts`: type, default 30, config template comment and file-config read.
- [x] 1.3 Give `decayItems` an item type; for workflows use `max(evidence count, frequency ?? 1)` and `CONFIG.userProfileWorkflowStaleDays ?? 30`; confirm 1.1 passes.
- [x] 1.4 Run `bun test tests/user-profile-decay.test.ts` and the other `tests/user-profile-*.test.ts` files one by one; confirm they pass.

## 2. Forced profile re-analysis

- [x] 2.1 Add tests to `tests/profile-import.test.ts`: forced run reprocesses `imported` rows, unforced run skips them, forced dry run counts them and writes nothing, an existing learned prompt is marked waiting with one copy kept; confirm they fail on current code.
- [x] 2.2 Add `markForUserLearning(promptId)` to `src/services/user-prompt/user-prompt-manager.ts` and to the import's `PromptStore` type.
- [x] 2.3 Add a `force` option to `importProfileFromHistory`; skip `imported` rows only without it, and call `markForUserLearning` for forced rows; confirm 2.1 passes.
- [x] 2.4 Pass `force` to the profile import from `src/importer/importer.ts`, `src/importer/opencode-import.ts` and `src/importer/claude-import.ts`; add a test that a forced run through `run-import.ts` reaches the profile import.
- [x] 2.5 Update the `--force` help line in `src/importer/import-args.ts`; confirm `tests/import-args.test.ts` passes, updating its expected help text if it asserts it.
- [x] 2.6 Check the web import form label or hint for force; update its text in `web/` if it says memory units only.

## 3. Documentation

- [x] 3.1 Add `userProfileWorkflowStaleDays` to `docs/configuration.md`.
- [x] 3.2 Update `--force` in `docs/cli.md`, `docs/opencode-history-import.md`, `docs/pi-history-import.md` and `docs/claude-code-history-import.md`; add the `--force --skip-memories` rebuild example with a dry run first.

## 4. Verification

- [x] 4.1 Run `bun run check`; confirm it passes.
- [x] 4.2 Run `bun run ci:local`; confirm it passes.
- [x] 4.3 Run `bun run build`, then `om-memory-system import-pi-history --scope all-projects --force --skip-memories --dry-run` from this worktree's build; confirm the profile count includes the done prompts and nothing is written.
- [x] 4.4 Run `openspec validate workflow-retention --strict`; fix every finding.
