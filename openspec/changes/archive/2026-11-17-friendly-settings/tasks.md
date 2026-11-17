# Tasks

Groups 1, 2 and 5 can start at once. Group 3 and 4 need the interfaces of groups 1 and 2 (named in design.md decisions 3, 4 and 5). Groups 6 and 7 need group 5. Each group owns the files listed under its heading; no other group edits them. Run one test file with `bash scripts/run-tests-isolated.sh <file>`. Prove each new test fails before the code it checks exists, and break the code once (mutation check) to see it fail.

## 1. Config core

Owns: `src/config.ts`, `src/config-template.ts`, `src/utils/memory-limits.ts`, new `src/services/config-problems.ts`, `tests/config-problems.test.ts` (new), `tests/config.test.ts`, `tests/config-resolution.test.ts`, `tests/omms-config.test.ts`, `docs/configuration.md`, `docs/upgrading.md`, `README.md`.

- [x] 1.1 Write `tests/config-problems.test.ts`: a missing comma on line 12 gives file, line 12, a column and a plain sentence; no file text appears in the problem; `buildTolerant` with `autoCleanupRetentionDays: 0` and a valid `memoryModel` keeps the model, uses the default days and records one problem naming the key and its range. Confirm it fails.
- [x] 1.2 Add regression tests in `tests/config-resolution.test.ts`: no file gives `autoDeleteOldMemories` false; a file with `"autoCleanupEnabled": true` and no new key gives `autoDeleteOldMemories` false and no problem; a file with `"autoDeleteOldMemories": true` gives true; a project file cannot turn it on; an old file with `maxProfileItems` and the three `userProfileDisplay*` keys loads with no error and no problem. Confirm they fail on the old code.
- [x] 1.3 Implement `src/services/config-problems.ts` (pure helpers plus problem list, no `CONFIG` import) and `ConfigValueError`. Make the validators in `config.ts` and `memory-limits.ts` throw it with their current messages. Verify 1.1 passes.
- [x] 1.4 In `config.ts`: record parse problems in `loadConfigFromPaths`, load through `buildTolerant`, add `autoDeleteOldMemories` (default `false`, dropped from project overrides), stop reading `autoCleanupEnabled` in `buildConfig` (keep it in `OmmsConfig` as an ignored key so old files type-check), remove the four unread keys and their `tests/config.test.ts` checks, and update `tests/config-resolution.test.ts` and `tests/omms-config.test.ts` cases that assert `CONFIG.autoCleanupEnabled`. Keep `config.ts` under its ceiling. Verify 1.2 passes.
- [x] 1.5 In `config-template.ts`: replace the active `autoCleanupEnabled` and `autoCleanupRetentionDays` lines with commented-out `autoDeleteOldMemories` and `autoCleanupRetentionDays` under a warning that deletion removes memories, and remove the four keys. Verify a template test finds no active `autoCleanupEnabled` or `autoDeleteOldMemories` line.
- [x] 1.6 Update `docs/configuration.md`: the cleanup section (`autoDeleteOldMemories`, what it deletes, default off, all three hosts, housekeeping, `autoCleanupEnabled` retired and ignored, the manual Cleanup button unchanged), the troubleshooting entry for a broken file and a value out of range, line 3 (Claude Code capture needs an external API), line 98 (list of page-editable keys), line 182 (Memory limits location), the removed keys, and the Default and Affects columns for the new UI keys. Grep `docs/` and `README.md` for `autoCleanupEnabled` and fix each hit (including the global-only list at `configuration.md:433`). In `docs/upgrading.md`, say that automatic deletion stops after the update even when the file says `"autoCleanupEnabled": true`, that nothing is lost, and that the Memory cleanup card switch turns it on again.

## 2. Cleanup engine

Owns: `src/services/cleanup-service.ts`, `tests/cleanup-maintenance.test.ts` (new), `tests/cleanup-count.test.ts` (new), `tests/cleanup-capture-retry.test.ts`, `docs/adr/051-memory-deletion-is-opt-in.md` (new), `docs/adr/ADR_README.md`.

- [x] 2.1 Write `tests/cleanup-maintenance.test.ts`: with `deleteOld` false, old capture attempts and old retry rows are pruned and no memory or prompt is deleted; with true, old unpinned memories go and pinned ones stay; a second call the same day does nothing; `startDailyMaintenanceTimer()` with a config of `autoCleanupEnabled: true` and no `autoDeleteOldMemories` runs housekeeping and deletes no memory (web app timer path). Confirm it fails.
- [x] 2.2 Write `tests/cleanup-count.test.ts`: 12 old unpinned, 3 old pinned and 2 linked-prompt memories give a count of 12 for 30 days and delete nothing. Confirm it fails.
- [x] 2.3 Implement `runDailyMaintenance(deleteOld)`, `countCleanupCandidates(days)` sharing the selection with the delete loop, and `startDailyMaintenanceTimer()` (reads `autoDeleteOldMemories` only). Remove the switch check from `shouldRunCleanup()`. Keep `runCleanup()` unchanged for the manual button, which keeps its own confirm. Verify 2.1, 2.2 and the existing cleanup tests pass.
- [x] 2.4 Mutation check: make the timer read `autoCleanupEnabled` instead of `autoDeleteOldMemories`; the old-file case in 2.1 must fail. Restore.
- [x] 2.5 Write ADR 051: deletion moves to `autoDeleteOldMemories`, `autoCleanupEnabled` is retired so an old file never deletes, no file rewrite, housekeeping is separate, the manual button is unchanged. Add it to `ADR_README.md`.

## 3. Host wiring

Owns: `src/v2/session-events.ts`, `src/v2/startup.ts`, `src/adapters/pi/extension.ts`, `src/adapters/claude-code/hook-client.ts`, `src/importer/claude-hook-context.ts`, `tests/v2-session-events.test.ts`, `tests/opencode-web-ensure.test.ts`, a Pi extension test, a Claude Code hook client test, `docs/opencode-adapter.md`, `docs/pi-adapter.md`, `docs/claude-code-adapter.md`.

- [x] 3.1 Extend `tests/v2-session-events.test.ts`: idle runs daily maintenance with capture off, and passes `deleteOld` from `autoDeleteOldMemories`; with `autoCleanupEnabled: true` and no new key, idle passes `deleteOld` false. Confirm it fails.
- [x] 3.2 Add a Pi test: a settled turn starts daily maintenance without waiting for it; with `autoCleanupEnabled: true` and no new key it passes `deleteOld` false; `session_start` with a recorded problem shows one warning notice. Confirm it fails.
- [x] 3.3 Add Claude Code tests for the shared notices contract: the SessionStart request carries `"notices": true`; a reply `systemMessage` string is copied to `systemMessage` in the one stdout JSON object and not into `additionalContext`; a reply without it prints no `systemMessage`; on the web app side, a request with `notices` and a recorded problem gets the problem line in `systemMessage`, and a request without `notices` gets none. Confirm they fail.
- [x] 3.4 Mutation check: make the OpenCode idle and Pi triggers read `autoCleanupEnabled`; the old-file cases in 3.1 and 3.2 must fail. Restore.
- [x] 3.5 Wire OpenCode (idle trigger before the capture-off return, `deleteOld` from `autoDeleteOldMemories`, notice at start) and Pi (trigger after `agent_settled`, notice at `session_start`). For Claude Code, add the `notices` flag and the `systemMessage` copy in `hook-client.ts` (a few lines; if `seamless-setup` merged first, reuse its code), and build the `systemMessage` lines in `claude-hook-context.ts`. Verify 3.1 to 3.3 pass and `src/importer/claude-hook-api.ts` does not grow.
- [x] 3.6 Update the three host guides: when housekeeping and optional deletion run, and how a config problem shows.

## 4. Settings server

Owns: `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/memory-key-source.ts`, `src/importer/external-api-test.ts`, new `src/services/settings-routes.ts`, `src/services/web-route-modules.ts`, `src/services/web-server.ts`, `tests/global-config-writer.test.ts`, `tests/web-settings-api.test.ts`, `tests/web-settings-route.test.ts`, `tests/web-external-settings.test.ts`, `tests/settings-routes.test.ts` (new).

- [x] 4.1 Extend `tests/global-config-writer.test.ts`: the seven new keys (`autoCaptureEnabled`, `chatMessage.enabled`, `visibleRecall`, `injectProfile`, `memory.defaultScope`, `autoDeleteOldMemories`, `autoCleanupRetentionDays`) save and validate; `autoCleanupEnabled` is refused as not editable (`memory.defaultScope` only `project` or `all-projects`; days whole numbers of 1 or more); `chatMessage.enabled` keeps the other `chatMessage` keys; `memoryApiUrl` without `http://` or `https://` is refused; `null` removes `memoryApiUrl` and `memoryModel`. Confirm it fails.
- [x] 4.2 Add snapshot tests: a broken global file returns `problems` with line and column and `readOnly: true` instead of throwing; a project value for `autoCaptureEnabled` shows as a project override; a file with `"autoCleanupEnabled": true` and no `autoDeleteOldMemories` returns `legacyCleanupKey: true`. Confirm it fails.
- [x] 4.3 Add `tests/settings-routes.test.ts`: the cleanup preview returns the count for given days and refuses a non-number; the key route saves a pasted reranker key to a user-only file and sets `rerankerApiKey`, with no key in the reply; the External API test with a form body uses the typed model and redacts a pasted key. Confirm it fails.
- [x] 4.4 Implement the writer and snapshot changes. Verify 4.1 and 4.2 pass.
- [x] 4.5 Create `settings-routes.ts` with the preview route, the key route moved from `web-server.ts` with the `setting` field, and the External API test body. Register it in `web-route-modules.ts`. Start the daily maintenance timer at web app start. Verify 4.3 passes and `web-server.ts` stays at or under 1837 lines.

## 5. Web shared pieces

Owns: new `web/src/lib/settings-catalogue.ts`, `web/src/lib/provider-names.ts`, `web/src/lib/reranker-messages.ts`, `web/src/lib/i18n/settings-catalogue.ts`, new components in `web/src/lib/components/settings/`: `SettingRow.tsx`, `KeySourceField.tsx`, `SettingsConfirmDialog.tsx`, `SettingsSearch.tsx`, `ConfigProblemBanner.tsx`; web specs `settings-catalogue.spec.ts`, `settings-plain-text.spec.ts`, `key-source-field.spec.tsx`, `settings-search.spec.tsx`, `settings-confirm-dialog.spec.tsx`; `.claude/skills/omms-design/references/components.md`.

- [x] 5.1 Write `web/tests/settings-catalogue.spec.ts`: every key the writer accepts has a catalogue entry with name, description, default, affects, page and anchor; every text exists in English, Chinese and Arabic. Confirm it fails.
- [x] 5.2 Write `web/tests/settings-plain-text.spec.ts`: each reranker code and an unknown code give a sentence; each provider id gives a display name. Confirm it fails.
- [x] 5.3 Write component specs: `KeySourceField` offers the three sources (and No key when optional) and shows the shell-variable warning; `SettingsSearch` finds `reranker` on the Memory page and shows the config-file note on no match; `SettingsConfirmDialog` sends nothing until confirm and keeps a server error inside; `ConfigProblemBanner` shows file, line and column. Confirm they fail.
- [x] 5.4 Implement the modules, texts and components with the shared `ui/` controls and logical classes. Verify 5.1 to 5.3 pass.
- [x] 5.5 Add `SettingRow`, `KeySourceField`, `SettingsSearch` and `ConfigProblemBanner` to the `omms-design` components reference.

## 6. Settings page cards

Owns: `web/src/lib/components/settings/SettingsView.tsx`, `web/src/lib/settings-sections.ts`, new `MemoryBasicsSection.tsx` and `MemoryCleanupSection.tsx`, `ExternalApiSection.tsx`, `EmbeddingSection.tsx`, `DiagnosticsSection.tsx`, `WebAppSection.tsx`, `ApiTokensTable.tsx`, `ProfilesSection.tsx`, `KeysAccessSection.tsx`, `HealthSection.tsx`, `ModelsSection.tsx`, `ClaudeFolderSection.tsx`, `web/src/lib/embedding-settings.ts`, `web/src/lib/external-api-settings.ts`, `web/src/lib/credential-states.ts`, `web/src/lib/i18n/settings.ts`, specs `memory-basics-section.spec.tsx`, `memory-cleanup-section.spec.tsx`, `external-api-section.spec.tsx`, `diagnostics-retention.spec.tsx`, `embedding-section.spec.tsx`, `tests/settings-toc.test.ts`, `docs/web-ui-settings.md`.

- [x] 6.1 Write specs: Memory basics saves `chatMessage.enabled` false and shows a project override; Memory cleanup shows the warning, opens the dialog with the count before saving `autoDeleteOldMemories` on, saves nothing on Cancel, refuses to save on when the count cannot be read, and shows the retired-key note when `legacyCleanupKey` is true; External API Test sends the form values and the URL can be cleared; retry retention 0 opens a dialog with the waiting count; the Embedding lock is a shared button with an icon and llama.cpp is the first preset. Confirm they fail.
- [x] 6.2 Add `MemoryBasicsSection` and `MemoryCleanupSection`, first in `settings-sections.ts`, and mount `SettingsSearch` and `ConfigProblemBanner` in `SettingsView`; disable Save when the snapshot is read-only. Verify the specs and `tests/settings-toc.test.ts` pass.
- [x] 6.3 Rework External API and Embedding key entry to `KeySourceField`; External API Test sends the form; provider names from `provider-names.ts`; `window.confirm` replaced by `SettingsConfirmDialog`; llama.cpp first in the presets. Verify 6.1 specs pass.
- [x] 6.4 Diagnostics retention fields: Save button, field messages, confirm before 0. Web app and External API text names all three hosts. Replace raw `<button>` in the owned cards. Verify with `rg "<button|window.confirm" web/src/lib/components/settings` showing only files outside this group.
- [x] 6.5 Apply `SettingRow` to each owned card. Update `docs/web-ui-settings.md`: the two new cards, search, problem banner, key-entry control, save pattern, three-host wording.

## 7. Memory page settings cards

Owns: `web/src/lib/components/memory/MemorySection.tsx`, `RerankerSection.tsx`, `KeywordModeSection.tsx`, `MemoryInjectionSection.tsx`, `AutoCleanupSettings.tsx`, `web/src/lib/keyword-mode-controls.ts`, `web/src/lib/memory-controls.ts`, `web/src/lib/settings-navigation.ts`, specs `reranker-section.spec.tsx`, `memory-limits-plain.spec.tsx`, `docs/web-ui-memory.md`.

- [x] 7.1 Write specs: a Memory limits row leads with a plain name and shows the key as secondary text; a failed reranker test shows a sentence, not `reranker_unreachable`; the reranker key uses `KeySourceField` with paste. Confirm they fail.
- [x] 7.2 Apply `SettingRow` and catalogue texts to the four cards; replace the `ceil(UTF-8 bytes / 4)` wording and the rank fusion label with plain words from the catalogue (new strings only in the group 5 text file); replace raw `<button>`; add the search anchors to `settings-navigation.ts`. Verify 7.1 passes.
- [x] 7.3 Update `docs/web-ui-memory.md` for the plain labels, the reranker key choices and the reranker messages.

## 8. Verification

- [x] 8.1 Run each new and changed test file through `scripts/run-tests-isolated.sh` and record the exit lines. Add `tests/cleanup-deletion-paths.test.ts`: the real config and cleanup service behind the OpenCode idle, Pi settled and web app timer triggers; an old file deletes nothing and `autoDeleteOldMemories: true` deletes exactly the counted memories.
- [x] 8.2 Run `bun run check` and `bun run build`; both exit 0.
- [x] 8.3 Run `bun run ci:local`; read the real exit line. (2026-11-17, after the review fixes: exit 0, 613 test files, 5,368 tests passed, 0 failed.)
- [x] 8.4 Live check in a scratch HOME on a free port at 1280 px and 390 px: search finds a Memory page setting; Memory basics and Memory cleanup save; the cleanup dialog shows a count; a broken config file shows the banner with the line; the reranker paste key works; no horizontal page scroll at 390 px; Arabic layout mirrors. (2026-11-17, evidence in the run's scratch folder, `live-friendly-settings/shots/` and `measure-390-*.json`. Defects it found are fixed with tests: External API Save tests first and refuses 401/403, plain translated test-failure sentences, one deletion log line, Cancel resets the deletion switch, translated broken-file banner, last good values in read-only view, switch shown off for rejected days, focus moves to the searched card, plain-words rewrites.)
- [x] 8.5 Live check a broken config file in OpenCode, Pi and Claude Code: each shows the problem once, and Claude Code shows it through `systemMessage`. (2026-11-17, scratch HOME and a scratch package at version 6.5.99-live: a missing comma and `autoCleanupRetentionDays: "abc"` each showed once at start and not on later turns. Claude Code 2.1.326 interactive showed it as `SessionStart:startup says: ...` and the hook printed it in `systemMessage`; Pi RPC mode with Haiku 4.5 gave one warning over two turns; OpenCode 2.2.6 gave one log line over two turns, as the docs describe, because the V2 server plugin has no toast API. The line, column and plain fix text matched for every host. The real `~/.omms/runtime.json` was unchanged.)
- [x] 8.6 Live check with a scratch store holding memories older than 30 days and a config file with `"autoCleanupEnabled": true` and no `autoDeleteOldMemories`: after an OpenCode idle, a Pi settled turn and a web app maintenance run, the memory count is unchanged and the Memory cleanup card shows the retired-key note. (2026-11-17, the run's scratch folder: with the old-style file the store kept all 20 memories, 0 deleted (`counts-3d-before.json`, `counts-3d-after.json`), and the card showed the note (`shots/d-cleanup-legacy-note.png`); after the switch was confirmed with a count of 11, the run deleted exactly 11, 20 to 9 (`counts-3b-before.json`, `counts-3b-after-run1.json`). The OpenCode idle and Pi settled paths are also covered by `tests/cleanup-deletion-paths.test.ts`.)
- [x] 8.7 Run `openspec validate friendly-settings --strict` and `graphify update .`.

## 9. Review fixes

- [x] 9.1 Write `tests/cleanup-count-matches-deletion.test.ts` (unlinked, linked to an old prompt, linked to a recent prompt, pinned, memorisation, recent); confirm it fails. Make the count and the delete share `findOldMemories`, and delete a memory in the same run as its old prompt. Update the two-step assertions in `cleanup-maintenance`, `cleanup-count` and `settings-routes`.
- [x] 9.2 Say "at its next daily check" in the cleanup dialog, in three languages; make the manual Cleanup confirm name memorisations; fix the template sentence.
- [x] 9.3 Add fail-safe keys and strict booleans in `config-problems.ts`; use the tolerant build on reload; validate only edited keys on save (`buildKeeping`); name the line and say "Fix the file" for keys no card writes. Tests in `config-problems.test.ts` and `global-config-writer.test.ts`, each seen failing first.
- [x] 9.4 Problem banner: plain sentence first, key as secondary text, accepted values translated.
- [x] 9.5 Profile tidy switch in form state with one Save; External API key checked and saved first, fields cleared, errors translated; retry-off dialog reads a fresh count; every Save and Apply on the Settings and Memory pages off while read-only.
- [x] 9.6 Correct the web app login item text and five catalogue defaults; add `tests/settings-catalogue-defaults.test.ts`; anchor spec with the `autoBackfill` exception; web app timer start and stop test; raw `<input>` in the no-raw-control specs.
- [x] 9.7 Search: retired `autoCleanupEnabled` finds Memory cleanup; Arabic ignores short vowels. Rewrite the three unclear strings.
- [x] 9.8 Update `docs/upgrading.md`, `docs/configuration.md`, the host guides, ADR 051, the design and the spec deltas.

## Workflow follow-up

- Run the verify skill, then archive the change before the pull request.
