## 1. Shared change list

- [ ] 1.1 Write tests for a pure `settingsChanges(saved, draft, fields)` helper in `web/src/lib/settings-changes.ts`. Cover these cases:
  - no change
  - one change
  - two changes in field order
  - a boolean as On and Off
  - a reset to default shown as "Default (value)"
  - a nested key such as `compaction.enabled`

  Run them and confirm that they fail.

- [ ] 1.2 Add the helper and a `SettingsChangeList` component that renders the rows. Make 1.1 pass. Add its strings in English, Chinese and Arabic.
- [ ] 1.3 Split `web/src/lib/components/memory/DirectoryMapsSection.tsx` (500 lines): move the ignored-folders list into its own component, with no behaviour change. Run its tests and `tests/file-size-ceiling.test.ts`.

## 2. Settings page cards

For each task: write the tests first and prove that they fail. Each card's tests cover:

- no request before confirm
- Cancel sends nothing, and a save-on-change control shows its saved value again
- confirm sends the same body as today
- a server error stays in the dialog

Update existing tests that expect an immediate request, without weakening what they check.

- [ ] 2.1 `settings/ModelsSection.tsx` (Save model), `settings/ClaudeFolderSection.tsx` (Save folder), `settings/WebAppSection.tsx` (Save), `settings/MemoryBasicsSection.tsx` (Save).
- [ ] 2.2 `settings/CaptureLanguageSection.tsx` (the select saves on change; it holds a pending value and `onCancel` restores it).
- [ ] 2.3 `settings/SkillLearningSection.tsx` and `skills/use-skill-settings.ts`:
  - the Record agent turns switch
  - the redaction switch, where the inline Callout is replaced by the dialog and both directions confirm
  - `skills/RecordPast.tsx` (Record past turns)
- [ ] 2.4 `settings/KeysAccessSection.tsx` (Save password, Clear password) and `settings/ApiTokensTable.tsx` (Generate token).
- [ ] 2.5 `settings/EmbeddingSection.tsx` (Retry after a failed re-embed) and `settings/CaptureControls.tsx`:
  - Retry now, also through `DiagnosticsSection.tsx`
  - the plain retention Save; the trace and zero-retention dialogs stay as the confirmation for their paths
- [ ] 2.6 `settings/ReasoningLevel.tsx` (normal Save), `settings/OpenRouterRouting.tsx` (Save routing), `settings/MemoryCleanupSection.tsx` (turning off and raising the days; the count dialog stays for turning on and lowering the days).
- [ ] 2.7 `settings/ExternalApiSection.tsx`:
  - a passing test opens the confirm dialog
  - an emptied URL or model confirms that the external API turns off
  - Save anyway stays as the confirmation when the test cannot reach the server

  Keep the file at 500 lines or fewer.

## 3. Memory page cards

Test-first rule as in group 2.

- [ ] 3.1 `memory/MemorySection.tsx`: Save memory limits and each row's Reset to default.
- [ ] 3.2 `memory/KeywordModeSection.tsx`, `memory/AutoCleanupSettings.tsx`, `memory/ProfileLearningSettingsSection.tsx` (Save; the Reset to default dialog stays) and `memory/ProfileCatchUpSection.tsx` (Pause).
- [ ] 3.3 `memory/RerankerSection.tsx`: Save confirms after a passing test; "Replace the key file?" stays as the confirmation for its path. Keep the file at 500 lines or fewer.
- [ ] 3.4 `memory/DirectoryMapsSection.tsx`: Save removals and Restore. `settings/DirectoryMapHost.tsx`: Ignore.
- [ ] 3.5 `memory/HostSettings.tsx`: Save model, and turning automatic import off (turning it on keeps `TurnOnDialog`).
- [ ] 3.6 `memory/HostStatusHeader.tsx` and `memory/use-backfill.ts`: Use external API, Pause, Resume and Retry.
- [ ] 3.7 `memory/MemoryInjectionSection.tsx`: Save. The draft-only Reset to default opens no dialog; the Save after it lists the removed keys.

## 4. Docs and rules

- [ ] 4.1 Update `web/AGENTS.md` (Actions): the rule covers settings saves and settings job actions, and local-only view preferences are excluded. Update `docs/web-ui-settings.md` and `docs/web-ui-memory.md`: each save asks first, with the dialog shown once in each guide. Run Prettier on the changed files.

## 5. Verification

- [ ] 5.1 Run `bun run check` and the web test files changed in groups 1 to 3, then `tests/file-size-ceiling.test.ts`.
- [ ] 5.2 Browser check with Orca on a scratch web app (scratch HOME, free port). Check one form Save, one save-on-change select, one job action and one Reset to default:
  - Cancel writes nothing (check the scratch config file)
  - confirm writes the same value as before

  Check desktop and 390 px widths and the Arabic layout. Save the screenshots in the scratchpad.

- [ ] 5.3 Run `bun run ci:local` and confirm that the exit line shows exit 0.
- [ ] 5.4 Run `graphify update .`.
