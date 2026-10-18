## 1. Logger levels

- [x] 1.1 Add tests in `tests/logger-level.test.ts` for the line format: no level writes `INFO`, `"warn"` writes `WARN`, `"error"` writes `ERROR`, data stays JSON after `: `, and session markers do not change. Confirm the tests fail on the current logger.
- [x] 1.2 Add the optional `level` argument to `log()` in `src/services/logger.ts` and write the level token. Make the tests pass.

## 2. Tag call sites

- [x] 2.1 Run an `ast-grep` scan for `log($MSG, $$$)` calls whose message matches the error or warn words. Save the list with a decision per call in this change's folder as `call-sites.md`.
- [x] 2.2 Add `"error"` to the calls that report a failed operation, including `Failed to initialize embedding model` (`src/services/embedding.ts`) and `addMemory: error`.
- [x] 2.3 Add `"warn"` to the calls that report a fallback, skip, retry or unavailable feature, including `OpenCode host fetch unavailable; falling back to global fetch` (`src/index.ts`).
- [x] 2.4 Run `bun run check` and the focused tests of every touched module. Confirm that no message text or data changed: `git diff` shows only added level arguments.

## 3. Log reader and API

- [x] 3.1 Add tests to `tests/settings-log.test.ts` for the record parser: new-format lines, legacy lines with a guessed level, the legacy `{"error":null}` case reading `info`, session markers, the capture filter combined with a level filter, and the 200-record limit applied after filtering. Confirm they fail first.
- [x] 3.2 Change `readSettingsLog` in `src/services/settings-log.ts` to return `{ path, records }` with `seq`, `time`, `level`, `guessed`, `message` and `data`, and to filter by minimum level. Keep the 256 KB bound and the fixed path.
- [x] 3.3 Pass the `level` query value through in the `/api/settings/log` handler in `src/services/web-server.ts`. Confirm the file does not grow past its ceiling entry.

## 4. Settings log UI

- [x] 4.1 Add `info` and `warning` variants to `web/src/lib/components/ui/badge.tsx` from the `--status-info` and `--status-warning` tokens.
- [x] 4.2 Add `web/src/lib/components/settings/LogPanel.tsx`: the record list with time, level badge (with "guessed" in its accessible name and tooltip), message and data, and follow-at-bottom scrolling.
- [x] 4.3 Rewrite `LogSection.tsx`: level chips All, Warning and Error; the capture-attempts filter; Pause and Resume; 5-second polling only while the section is visible and not paused; copy visible records; copy log path; the empty and error states.
- [x] 4.4 Add every new string to `web/src/lib/i18n/settings.ts` for each language.
- [x] 4.5 Check the section in the browser at desktop and mobile widths, in light and dark themes, using the keyboard only. Load the `omms-design` skill first.

## 5. Docs and checks

- [x] 5.1 Update the Log section of `docs/web-ui-settings.md`: level chips, badges, guessed levels, Pause and Resume, copy actions, and the new line format.
- [x] 5.2 Run `bun run ci:local` and confirm it passes.
- [x] 5.3 Run `openspec validate add-log-levels --strict` and fix every finding.
