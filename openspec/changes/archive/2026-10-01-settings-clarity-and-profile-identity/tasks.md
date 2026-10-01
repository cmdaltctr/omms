## 1. Profile identity (server)

- [x] 1.1 Add tests in `tests/tags.test.ts`: a directory with no `.git` or marker above it allows `git` from `PATH`; a `git` inside a repository root is still refused. Confirm the first test fails on the current code.
- [x] 1.2 Fix `findUntrustedProjectRoot` and `resolveTrustedGitCommand` in `src/services/tags.ts`.
- [x] 1.3 Add `src/services/profile-identity.ts` with `resolveProfileUserId(config, deps)`: override, cwd git email, global git email, only active profile. Add `tests/profile-identity.test.ts` for each step of the order.
- [x] 1.4 Use the resolver in `handleGetUserProfile`, `handleUpdateProfileItem`, `handleRefreshProfile`, and the AI cleanup handlers.
- [x] 1.5 Add `stripProfileVectors` and call it in the GET profile and snapshot handlers. Test: the response has no `centroid` or `anchor`; a PATCH delete keeps the stored vectors of the other items.

## 2. Profiles card

- [x] 2.1 Add `deactivateProfile(id)` to `userProfileManager`, with a test.
- [x] 2.2 Add `GET /api/user-profiles`, `POST /api/user-profiles/use`, and `POST /api/user-profiles/merge` behind the settings origin and auth guard. Tests: list counts, use writes `userEmailOverride`, merge combines items, adds the prompt count, writes a changelog entry, and deactivates the source; unauthenticated writes are refused.
- [x] 2.3 Add `ProfilesSection.tsx` to the Settings page, shown only with more than one active profile, with confirm dialogs for use and merge.

## 3. Keys and access table

- [x] 3.1 Move the table class constants to `web/src/lib/components/settings/table-styles.ts` and use them in `DiagnosticsSection.tsx`.
- [x] 3.2 Render `CredentialRows` with a caption, a header row of five headings, and the shared styles. Keep the row data and states unchanged.

## 4. Capture diagnostics

- [x] 4.1 Add a pure `groupOutcomesByHost(rows)` in `web/src/lib/` with tests: host totals, model rows, a `null` model labelled model not recorded, and percentages of the row total.
- [x] 4.2 Render host rows with a show/hide control for model rows, and the column note above the table.

## 5. Import status and automatic import

- [x] 5.1 Add `phase`, `profile_done`, and `profile_total` to `import_runs`, set them from the runner around the profile backlog loop, and return them from `readImportRun`. Tests in `tests/backfill-controls.test.ts` or a new file: the phase changes to profile after the last exchange and the run ends as done.
- [x] 5.2 Add `importStatusBadge` to `web/src/lib/auto-import-settings.ts` with a test for each badge in the spec.
- [x] 5.3 Show the badge for each host in the Import and backfill section and in the Automatic import cards.
- [x] 5.4 In `AutoImportSection.tsx`, show the bar only for the exchange phase of an active run, show Learning profile with batch counts for the profile phase, and show the last run summary when no run is active.

## 6. Directory maps

- [x] 6.1 Count unresolved sessions the same way on the import card and in the list, and stop a one-project or selection run from replacing the list. Store sessions with no directory under one fixed entry. Tests: a one-project run keeps the full list; card count equals the sum of listed session counts; a one-project listing keeps the list.
- [x] 6.2 Render one inner card per host in `DirectoryMapsSection.tsx`, with the No directory recorded entry shown without a map input.
- [x] 6.3 Add the Smart resolve directories button and description to each host card. Add a pure `applySuggestions(rows)` with a test: fills suggested rows, leaves the rest, returns the filled and not-filled counts, and saves nothing.

## 8. Pi SDK and confidence badge

- [x] 8.1 Add `src/importer/pi-sdk.ts` with `loadPiSdk()` and use it in `session-loader.ts`, `import-readiness.ts`, and `settings-models.ts`. Tests in `tests/pi-sdk.test.ts`: managed install, `pi` on `PATH`, and not found.
- [x] 8.2 Show profile confidence as a rectangular badge coloured by band. Test `confidenceLevel` in `tests/web-confidence-level.test.ts`.
- [x] 8.3 Add TDR-021 and update `docs/cli.md` and `docs/shared-core.md`.
- [x] 8.4 Rerun `bun run ci:local`. Read a real Pi session from a copy of the build without the SDK, under launchd's `PATH`. Check the profile badges in the browser. A full Pi backfill from the login web app runs after release, because the login item runs the installed package.

## 7. Text, docs, and checks

- [x] 7.1 Add every new string to `web/src/lib/i18n/settings.ts` for each language. `tests/web-settings-i18n.test.ts` must pass.
- [x] 7.2 Update `docs/web-ui-settings.md`, `docs/web-ui.md`, and `docs/configuration.md` (`userEmailOverride` and split profiles).
- [x] 7.3 Add a TDR in `docs/tdr/` for the trust check bug that broke the profile page under the login item, and add it to the index.
- [x] 7.4 Run `bun run check` and `bun run ci:local`. Rebuild, restart the login web app, and check the profile page, the Profiles card, and each changed section in the browser.
