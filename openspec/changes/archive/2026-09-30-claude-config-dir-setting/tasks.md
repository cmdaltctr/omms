# Tasks

## 1. Resolver

- [x] 1.1 Write `tests/claude-folder.test.ts` for setting over variable over default, `~/` expansion, an empty or `undefined` value, and the source it reports. Confirm it fails before the module exists. Verify: `bun test tests/claude-folder.test.ts`.
- [x] 1.2 Add `src/services/claude-folder.ts` as one pure module with no storage engine, config, or reader import (design decision 1 says why it is in `src/services/`). Verify: the test in 1.1 passes, and `bun test tests/pi-adapter-boundary.test.ts`.
- [x] 1.3 Make `defaultClaudeProjectsRoot()` and `defaultClaudeSourcePath()` use it and accept the configured value. Delete the duplicate logic. Verify: `bun test tests/import-sources.test.ts tests/claude-reader.test.ts`.
- [x] 1.4 Extend the agreement test in `tests/import-sources.test.ts` to run with the setting and with the variable. Confirm it fails if either function ignores the setting. Verify: `bun test tests/import-sources.test.ts`.

## 2. Config key

- [x] 2.1 Write tests: `claudeConfigDir` loads from the global file, rejects a relative path, expands `~/`, and is ignored in a project config. Confirm they fail first. Verify: `bun test tests/config-resolution.test.ts`.
- [x] 2.2 Add `claudeConfigDir` to `OmmsConfig`, the defaults, the config template, validation, and the project override removal in `src/config.ts`. Verify: the tests in 2.1 pass.
- [x] 2.3 Add the key to the editable list and validation in `src/services/global-config-writer.ts` and `src/services/settings-snapshot.ts`, as a global-only key. The writer must accept an empty string for this key, so the page can clear it, and reject a relative path. Write those two tests first. Verify: `bun test tests/global-config-writer.test.ts tests/web-auto-settings.test.ts`.
- [x] 2.4 Add `claudeFolder: { root, source, exists }` to the settings snapshot. Verify: a snapshot test for each source and for a missing folder, in `tests/web-auto-settings.test.ts`.

## 3. Callers

- [x] 3.1 Capture route: pass `CONFIG.claudeConfigDir` to the resolver in `src/importer/claude-hook-api.ts`. Write the tests first: a transcript in the folder from the setting is accepted, and one in the default folder is rejected while the setting is set. Verify: `bun test tests/claude-hook-api.test.ts`.
- [x] 3.2 Web import readiness, session list, and folder picker: pass the setting through `src/importer/import-readiness.ts`, `src/importer/import-sessions.ts`, and `browseImportSources` in `src/importer/import-sources.ts`. Test with a custom folder. Verify: `bun test tests/import-sources.test.ts tests/import-readiness.test.ts`.
- [x] 3.3 Terminal importer and automatic backfill: in the Claude Code branch of `runHistoryImport` (`src/importer/run-import.ts`), set `root` from the resolver when `args.source` is absent. Write the test first: with the setting on a fixture folder and no `--root`, the run discovers that folder's sessions. Confirm it fails before the change. Verify: `bun test tests/claude-import.test.ts`.

## 4. Settings page

- [x] 4.1 Add `web/src/lib/components/settings/ClaudeFolderSection.tsx` and render it in `SettingsView.tsx`. Show the field, the folder in use, its source, and the missing folder warning. Verify: render tests for each state in `web/tests/claude-folder-status.spec.tsx`, written the way `web/tests/claude-capture-status.spec.tsx` is (run with `--tsconfig-override web/tsconfig.app.json`), a source check in `tests/web-auto-settings.test.ts`, and `bun run check`.
- [x] 4.2 Test that the capture route uses a folder saved on the page without a restart. Confirm it fails if the config is not refreshed. Verify: `bun test tests/claude-hook-api.test.ts`.
- [x] 4.3 Add every new string to `web/src/lib/i18n/settings.ts` for each language in that file. Verify: `bun test tests/web-settings-i18n.test.ts`.

## 5. Docs and checks

- [x] 5.1 Update `docs/web-ui-settings.md` and `docs/configuration.md` with the new field and key. Update `docs/claude-code-adapter.md` and `docs/claude-code-history-import.md`: remove the note that the web app needs the variable, and state the order setting, variable, default. Verify: `bun run format:check`.
- [x] 5.2 Run `bun run ci:local` and confirm it passes. Baseline: 188 test files, 1,224 tests, 0 failures, plus the new tests.
- [x] 5.3 Run `openspec-verify-change`, then `openspec-archive-change` before the pull request.
