## Why

The Directory maps section is hard to use. On the live page it is 3,863 px tall. The 34 saved maps fill 3,388 px of that, because each long path wraps. The only save button sits 3,810 px below the section heading, after the saved maps and all three host lists. A user who ticks rows does not see a save action, and Smart resolve looks like the only action.

Smart resolve cannot help when no row has a suggested target. In the Pi list, all four rows have no target: a temporary test folder, a package folder, a skill folder, and a renamed repository. The dialog then says "No maps to save" and disables Confirm. It gives no way to choose a target or to dismiss a row that is not a project. These rows stay in the list for good.

The suggestion rules miss too much. Of the 22 live unresolved rows, only 9 get a suggestion. A probe of the live data found these problems:

- A live linked worktree counts as a project, so a deleted `omms-feat-x-2` is mapped to the live worktree `omms-feat-x`, not to `omms`. Once that worktree is deleted, the map points at a missing folder and its sessions return as unresolved.
- The web server never passes the memory store's project list to the suggester. It searches only saved map targets and OpenCode worktrees.
- A moved repository gets no suggestion: `CLIENTS/restro-1-2025` now lives at `PROJECTS/praxis-vue-template/restro-1-2025`.
- When OpenCode's recorded project folder is also missing, the suggester stops instead of following it.
- A renamed repository gets no suggestion: `opinionated-modular-pi-subagents-system-ompss` is now `om-pi-subagents`.
- 8 of the 22 rows are not projects (temporary folders, `node_modules`, skill folders, app data), and nothing proposes to dismiss them.

Saved maps must stay after import. All three hosts resolve a session's directory before they check the import ledger (`importer.ts`, `opencode-import.ts`, `claude-reader.ts`). Removing a used map makes its sessions unresolved again on the next run. So the saved list will keep growing, and the page must keep it compact.

The Automatic import section shows all three host cards in full (1,180 px). A user works with one host at a time.

## What Changes

- Smart resolve becomes the one save path for unresolved directories. The dialog lists each proposed map with its own checkbox. Confirm saves the ticked maps only.
- **BREAKING (UI):** Remove the per-row "Use this map" checkbox, Select all with targets, Clear selection, and the bottom Save maps button. Each row keeps its editable target field. Smart resolve reads the edited targets.
- Add an Ignore action to each unresolved row. Ignored directories leave the host list and the unresolved counts. A collapsed "Ignored directories" list offers Restore. Ignore saves at once to a new global setting, `importIgnoredDirectories`. Import behaviour does not change: ignored sessions stay unimported.
- Improve the suggestion rules. Each suggestion is a map or an Ignore, with a confidence of exact, name, or guess:
  - Propose Ignore, with a reason, for temporary folders, `node_modules`, app data, and skill folders.
  - Match an existing project with the same stored git remote (exact).
  - Use OpenCode's recorded project folder (exact). When it is missing, apply the rules to it.
  - Resolve a linked worktree candidate to its main repository in the deleted-worktree name rule (name).
  - Match a moved folder: exactly one existing project with the same folder name (name).
  - Guess a rename by name parts and initials (guess).
  - Feed the memory store's project list to the suggester as known projects.
- The dialog shows each map's confidence. Exact and name maps come ticked; guesses come unticked. A "Suggested to ignore" group comes ticked. Confirm saves ticked maps and ticked ignores in one settings save.
- When the dialog has nothing to propose, it tells the user to type a target in the row or to ignore rows that are not projects.
- Collapse Saved maps into one disclosure with a count. Group the maps by target project, one nested disclosure per project. Removal stays per map, saved by a Save removals button inside the disclosure. The page says to keep maps after import, and why.
- The unresolved session count in Automatic import, the Import and backfill badge, and the host list exclude ignored directories.
- Put each Automatic import host card in a collapsed disclosure. The summary shows host, state, pending exchanges, and unresolved sessions. A card with a running or paused run opens by default. The Import past chats automatically switch stays above the cards.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `import-directory-maps`: Smart resolve dialog becomes the only save path, with per-item ticks and confidence; suggestion rules gain store projects, same-remote, moved-folder, missing-OpenCode-record, linked-worktree, rename-guess, and not-a-project rules; bulk selection and the bottom Save maps are removed; rows can be ignored and restored; saved maps collapse and group by target; counts exclude ignored directories; removing a map warns that its sessions return as unresolved.
- `web-settings`: Automatic import host cards become collapsed disclosures; unresolved counts and the Partly imported badge exclude ignored directories.

## Impact

- Web UI: `web/src/lib/components/settings/DirectoryMapsSection.tsx`, `DirectoryMapHost.tsx`, `DirectoryMapReviewDialog.tsx`, `AutoImportSection.tsx`, `web/src/lib/directory-maps.ts`, `web/src/lib/i18n/settings.ts` (English, Chinese, Arabic text).
- Suggestions: `src/importer/map-suggestions.ts` (new rules, suggestion kind and confidence), `src/importer/web-import-api.ts` and `src/services/web-server.ts` (pass known projects from the store), `src/services/shard-inventory-service.ts` (read-only project list, no change to its behaviour).
- Server: `src/config.ts` (new `importIgnoredDirectories`, global only), `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/web-server.ts` (subtract ignored sessions from `counts.unresolved` in `/api/settings/backfill`).
- Tests: `tests/web-directory-maps.test.ts`, `tests/map-suggestions.test.ts`, `tests/import-path-maps.test.ts`, `tests/global-config-writer.test.ts`, `tests/backfill-state.test.ts`.
- Docs: `docs/web-ui-settings.md`.
- No change to import resolution, the import ledger, or history files. Suggestions never write to OpenCode's database, the memory store, or git. All three hosts get the same UI and the same suggestion rules.
