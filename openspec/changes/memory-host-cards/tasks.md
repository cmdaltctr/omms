## 1. Reproduce the two reported bugs

- [x] 1.1 Add a test in `tests/web-directory-maps.test.ts` where a session listing records 21 unresolved OpenCode sessions and a later backfill records none. Assert the stored list still has 21. Confirm it fails on the current code.
- [x] 1.2 Add a test in `web/tests/memory-import-contract.spec.tsx` that ticks OpenCode, remounts the form with the same `localStorage`, and expects OpenCode still ticked. Confirm it fails on the current code.
- [x] 1.3 Reproduce **Run now** on a host with 0 pending exchanges. Record why `import_runs` showed `running` with the 9 Oct process id 95875 after the 18 Oct click. Fix it here if it is a bug, with a test, or record the finding in this change's `design.md`.

## 2. Unresolved directory coverage

- [x] 2.1 Add the `coverage` column to `unresolved_directories` with default `full`, and the conditional upsert in `src/services/backfill-state.ts`.
- [x] 2.2 Pass `partial` from `auto-backfill.ts` and from `run-import.ts` when `since` or `until` is set. Pass `full` from session listings and from runs without a date limit. Make 1.1 pass and add the "only a backfill has run" case.

## 3. Server: write health and host appearance

- [x] 3.1 Add `src/services/write-health.ts` that runs the Memory store and Embedding checks, redacts with `safeHealthError`, and caches for 30 seconds. Test pass, embedding 500, store failure, cache reuse, and that no secret appears in the reason.
- [x] 3.2 Add `GET /api/memory/write-health` through `memory-host-routes.ts` and the route-module hook, so `web-server.ts` does not grow past its ceiling entry.
- [x] 3.3 Add `src/services/host-appearance.ts` with read, set icon, set image (PNG signature, IHDR 128 × 128, ≤ 256 KB), reset, and atomic writes under `~/.omms/host-appearance/`. Test each rejection: unknown host, unknown icon, wrong size, not PNG, too large, SVG bytes.
- [x] 3.4 Add the four `/api/host-appearance` endpoints with the web API token rule for writes. Test that a write without the token is refused when a token is set.

## 4. Routing and navigation

- [x] 4.1 Add the memory view parser to `web/src/lib/routes.ts` for `/memory`, `/memory/pi`, `/memory/opencode`, `/memory/claude-code` and `/memory/shared`. Unknown sub-paths open the overview. Test in `web/tests/memory-navigation.spec.tsx`.
- [x] 4.2 Replace `legacyMemoryAnchor` with the old-anchor table: Settings anchors, `#memory-section-*` anchors and `#directory-maps-<host>`. Test every row of the table.
- [x] 4.3 Change the Memory children in `AppSidebar.tsx` to Pi, OpenCode, Claude Code and Shared, with a warning marker. Keep the collapsed-sidebar and mobile-drawer behaviour. Update `web/tests/memory-navigation.spec.tsx`.

## 5. Host status logic

- [x] 5.1 Add `web/src/lib/components/memory/host-status.ts` with the state, action and sentence rules from `design.md`. Write one test per table row, including paused with a model reason, nothing waiting before the cutoff, failed with a redacted code, and not set up.

## 6. Views

- [x] 6.1 Load the `omms-design` skill and read the Impeccable `craft-floor.md` before any UI edit.
- [x] 6.2 Split `ImportSection.tsx` into `MultiHostImport.tsx` and `HostSessions.tsx`. Keep current behaviour and make 1.2 pass with `localStorage` persistence of hosts and scope.
- [x] 6.3 Move the per-host unresolved rows from `DirectoryMapsSection.tsx` into `HostSessions.tsx`: folder field, suggestion, Ignore, Smart resolve, and **Ignore all** with its confirmation dialog. Saved maps and ignored directories stay for the Shared view. Update `web/tests/directory-map-controls.spec.tsx` and add Ignore all tests: confirm, cancel, save conflict.
- [x] 6.4 Add `HostCard.tsx` and `MemoryOverview.tsx`: four equal cards, status line, warning state, Not set up state, Import all hosts with its cost note, and a two-column grid below 640 px.
- [x] 6.5 Add `HostStatusHeader.tsx` and `HostView.tsx`: switcher, health strip with **Check again**, status header with the main action and sentence, **Use external API**, sessions and host settings.
- [x] 6.6 Add `SharedView.tsx` with one row each for profile learning, memory limits, keyword matching, reranker, saved directory maps and ignored directories, reusing the existing section components.
- [x] 6.7 Rewrite `MemoryView.tsx` to pick the view from the path, and remove the seven-section layout and `MEMORY_SECTIONS` users that no longer apply.
- [x] 6.8 Add the write-health client: ask on open, every 5 minutes while the tab is visible, and on **Check again**.
- [x] 6.9 Add the four-card switcher to the Shared view as `MemorySwitcher.tsx`, shared with the host views, and a nested contents list of the five Shared rows under Shared in the sidebar. Test both, and confirm each test fails without its feature.
- [x] 6.10 Show English sidebar entries and page titles in normal capitals (remove the capitals styles; store `Project memories`, `User profile`, `Chat`, `Preferences`, `Patterns` and `Workflows` in normal case), and give Shared an icon in the sidebar through a shared `SharedMark`. Update the tests that asserted capitals, and add tests for the labels and the icons.

## 7. Avatars

- [x] 7.1 Add `web/src/lib/avatar-image.ts`: type check from the first bytes, 20 MB limit, centre crop, 128 × 128 PNG export. Test a wide image, a tall image, an SVG, a 21 MB file and a WebP.
- [x] 7.2 Add `HostAvatar.tsx` (one fixed square size, default monogram in the host's `keywordHue`) and `AvatarDialog.tsx` (Change icon menu, upload with crop preview, searchable icon grid from the allow-list, reset).
- [x] 7.3 Show the avatars on the cards, the switcher and the sidebar.

## 8. Text, size and accessibility

- [x] 8.1 Add every new string to `web/src/lib/i18n/settings.ts` in `en`, `zh` and `ar`, and remove strings that no longer appear.
- [x] 8.2 Confirm every changed `web/src` file is at most 500 lines. Remove the ceiling entries of files that are now under the limit.
- [ ] 8.3 Check every view in the browser at 1280 px and 390 px, light and dark, `en` and `ar`, with the keyboard only. Cover running, paused, failed, nothing to import, not set up and the write-health warning.
- [x] 8.4 Run `impeccable detect --json` once on the changed web files and fix its findings.

## 9. Docs and checks

- [x] 9.1 Update `docs/web-ui-memory.md` and `docs/web-ui.md`: overview, host views, Shared view, avatars, the write-health check and its small embedding cost, Ignore all.
- [x] 9.2 Run `bun run ci:local` and confirm it passes.
- [x] 9.3 Run `openspec validate memory-host-cards --strict` and fix every finding.
