## 1. Ignored directories setting

- [x] 1.1 Write failing tests in `tests/import-path-maps.test.ts` for `parseIgnoredDirectories`: undefined gives `[]`, a non-list throws, a relative path throws, `~` expands, paths resolve.
- [x] 1.2 Add `parseIgnoredDirectories` to `src/importer/import-path-maps.ts`, reusing `expandHome` and the absolute-path check.
- [x] 1.3 Add `importIgnoredDirectories` to `src/config.ts` (type, default `[]`, parse, global-only strip next to `importPathMaps`, commented example in the template).
- [x] 1.4 Add the key to `src/services/global-config-writer.ts` (allowed keys, array validation) and `src/services/settings-snapshot.ts`. Extend `tests/global-config-writer.test.ts` for save and rejection.

## 2. Server views and counts

- [x] 2.1 Write failing tests in `tests/map-suggestions.test.ts`: `directoryMapsView` drops ignored directories from every host list and returns them as `ignored`.
- [x] 2.2 Update `directoryMapsView` in `src/importer/map-suggestions.ts`; read `CONFIG.importIgnoredDirectories ?? []`.
- [x] 2.3 Write failing tests in `tests/backfill-state.test.ts` for a pure `visibleUnresolvedCount(count, directories, ignored)`: subtracts ignored sessions, clamps at 0, leaves No directory recorded sessions counted.
- [x] 2.4 Add `visibleUnresolvedCount` to `src/services/backfill-state.ts` and apply it in the `GET /api/settings/backfill` handler in `src/services/web-server.ts` for each host.
- [x] 2.5 Confirm each new test fails with its implementation removed, then passes.

## 3. Suggestion engine

- [x] 3.1 Write failing tests in `tests/map-suggestions.test.ts`, one per rule, using temporary folders: not-a-project for each reason; same stored remote (exact) and two matching remotes (none); OpenCode record exists (exact) and missing then followed (rule's confidence); live linked worktree resolves to its main repository; moved folder with one match (name) and two matches (none); rename guess for `opinionated-modular-pi-subagents-system-ompss` → `om-pi-subagents` (guess) and a near miss with one exact part (none); rule order when two rules match.
- [x] 3.2 Change `suggestMapTarget` to return `{ kind: "map", target, confidence } | { kind: "ignore", reason } | null`, and update `SuggestedDirectory` and its callers.
- [x] 3.3 Add the not-a-project rule as a pure path check (rule 1).
- [x] 3.4 Resolve linked worktree candidates to their main working tree by reading the `.git` file's `gitdir:` line (rule 4).
- [x] 3.5 Add the same-remote rule (rule 2) and the moved-folder rule (rule 5) over a `knownProjects` input that carries paths, path candidates, and remotes.
- [x] 3.6 Follow a missing OpenCode recorded folder through rules 2 to 6, one level deep (rule 3).
- [x] 3.7 Add the rename guess rule (rule 6).
- [x] 3.8 In `directoryMapsView`, read the store inventory once per request through `ShardInventoryService.listShards`, read-only, and fall back to the other sources if it fails. Pass it as known projects from `web-import-api.ts`/`web-server.ts`.
- [x] 3.9 Add a test that building suggestions leaves the store files, the OpenCode database, and Git metadata unchanged (file modification times).
- [x] 3.10 Confirm each new test fails with its rule removed, then passes.

## 4. Directory maps logic

- [x] 4.1 Update `tests/web-directory-maps.test.ts` first: drop tests for `selectWithTargets`, `clearSelection`, `applySuggestions`, and accepted flags; add tests for the review's three groups, default ticks by confidence, edited targets counting as exact, the combined save payload for ticked maps and ignores, saved-map grouping by target, and the removal-only save payload.
- [x] 4.2 In `web/src/lib/directory-maps.ts`, remove `applySuggestions`, `selectWithTargets`, and `clearSelection`; make `reviewDirectoryMaps` return maps with confidence, ignore proposals, and unmapped rows; add `groupSavedMaps(saved)` (by target, count descending, then path); make the confirm payload take only ticked items.
- [x] 4.3 In `web/src/lib/external-api-settings.ts`, drop `accepted` from `MapDecision` and reduce `mapsToSave` to saved maps minus pending removals. Update callers.

## 5. Directory maps UI

- [x] 5.1 `DirectoryMapHost.tsx`: remove the row checkbox, Select all, Clear selection, and their copy. Put Smart resolve at the top of the expanded list. Add Ignore to each row with a recorded directory. Show an ignore proposal's reason in the row. Summary shows rows with a target instead of selected maps.
- [x] 5.2 `DirectoryMapReviewDialog.tsx`: three groups (Proposed maps with confidence labels, Suggested to ignore with reasons, No target); a checkbox per map and per ignore proposal with D8's default ticks; Confirm disabled when nothing is ticked; new empty-state text (D6).
- [x] 5.3 `DirectoryMapsSection.tsx`: Confirm writes ticked maps and ignores in one PATCH; saved maps in a collapsed disclosure grouped by target with Save removals and the keep-after-import note; Ignored directories disclosure with Restore; Ignore and Restore save at once with the revision check and an accessible error; remove the bottom Save maps.
- [x] 5.4 Update English, Chinese, and Arabic strings in `web/src/lib/i18n/settings.ts` (confidence labels, ignore reasons, group titles, empty state); remove strings no longer used.

## 6. Automatic import UI

- [x] 6.1 `AutoImportSection.tsx`: wrap each host card in `<details>`; summary shows host, state, pending, and unresolved as text; keep the switch and description above.
- [x] 6.2 Initialise each card's open state once from the first status load (open when running or paused); keep the user's choice across polling.
- [x] 6.3 Check that `revealDirectoryMaps` links from the card body and from the Partly imported badge still open the right host list.

## 7. Docs and checks

- [x] 7.1 Update `docs/web-ui-settings.md` for the suggestion rules and confidence labels, Smart resolve ticks, Ignore and Restore, grouped saved maps, the keep-after-import note, and collapsed Automatic import cards. Document `importIgnoredDirectories` in the config guide.
- [x] 7.2 Run `bun run check` and the focused test files for each changed module.
- [x] 7.3 Build and open the settings page in the worktree. Measure the section heights again. Check that the 22 live rows split into 13 maps (2 guesses), 8 ignore proposals, and 1 row without a target, without confirming anything against the real global config. Check one Confirm, Ignore, and Restore against a test config. Check 200% zoom and narrow width.
  - Done 2026-10-06. Heights (test config, 31 saved maps): Directory maps 494 px (was 3,863), Automatic import 384 px (was 1,180), all cards collapsed.
  - Live split read-only through the worktree code: 22 rows give 13 maps (2 guesses), 8 ignores, 1 without a target. Real `omms.jsonc` checksum unchanged. The page view of real data was not opened.
  - Test config at port 4758: Confirm wrote one map and one ignore in one save; row Ignore and Restore saved at once; badge, card, and list counts moved together.
  - Browser mobile viewport 390×844 (touch): no horizontal overflow, dialog body scrolls, Confirm and Cancel inside the viewport. 320 px width and 200% zoom NOT RUN: no 320 px preset in Orca, and CSS-zoom measurements were not reliable.
- [x] 7.4 Run `bun run ci:local` and `openspec validate directory-maps-cleanup --strict`.
  - Done 2026-10-06. `ci:local` passes. Fixed two tests on the way: `tests/web-external-settings.test.ts` used the removed row-selection argument of `mapsToSave`; `tests/claude-budget-timeout-regression.test.ts` looked for a passing test name, which Bun hides when `CLAUDECODE=1` is set, so the test failed inside Claude Code.
