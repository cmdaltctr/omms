# Tasks

## 1. Shared status and sidebar header

- [x] 1.1 Rebase this branch on `fix/restart-handoff` after it merges, and verify `git log` shows the restart fix commit.
- [x] 1.2 Move the status poll from `PowerButton.tsx` into a `useWebStatus` hook with one shared 15-second timer, and verify `web/tests/power-button.spec.tsx` still passes and a new test sees one request per interval with two readers mounted.
- [x] 1.3 Add the `--brand-label` token (`#678D6C`, both themes) to `web/src/app.css`, and verify the built CSS holds the value under both theme selectors.
- [x] 1.4 Change `brand` to `OMMS` in `en`, `zh`, and `ar`, and render the version after it in a smaller font with the normal text colour. Verify with a new `web/tests/sidebar-header.spec.tsx`: the version shows after a status answer, is absent before one, changes on a new version without reload, and is hidden when the desktop sidebar is collapsed.
- [x] 1.5 Describe the header in `docs/web-ui.md`, and verify `bun run format:check` passes.

## 2. npm release check in the web app

- [x] 2.1 Add `src/services/web-update.ts` with a check that runs at start and then every 6 hours, reuses `latestNpmVersion` and `availableUpdate`, follows `OMMS_DISABLE_UPDATE_CHECK`, and keeps the last result on failure. Verify with `tests/web-update-check.test.ts` using a fake fetch and clock: newer, same, prerelease, off, and failure cases.
- [x] 2.2 Add the `update` field to `GET /api/web/status` in `web-server.ts`, and verify with a server test that the reply includes `available`, `state`, `code`, and `canInstall`.

## 3. Install runner, route, and restart through the launcher

- [x] 3.1 Add the install runner to `web-update.ts`: npm beside `process.execPath`, fixed arguments, `x.y.z` check on the version, a 5-minute timeout, and a failure code from the error stream. Verify with unit tests on a fake spawn for success, `permission`, `network`, `npm-exit`, `timeout`, `npm-missing`, and a rejected version string. Confirm the log holds no npm output.
- [x] 3.2 Add a launcher option to `createPowerAction` in `src/cli/web-power.ts` that spawns `[launcherPath, "web"]`. Verify in `tests/web-power-action.test.ts` that the copy gets the launcher arguments and still carries `OMMS_WEB_INSTANCE`, and that a missing launcher gives `no-launcher` and keeps serving.
- [x] 3.3 Add `POST /api/web/update` with the loopback and token guard: `401`, `403`, `409` (no update or no npm), `202`, and `202` with no second install while one runs. Verify with `tests/web-update-route.test.ts`.
- [x] 3.4 Connect the runner to the restart: after npm exits with code 0, check the global version with `globalCommandVersion()`, then restart through the launcher, or report `version-mismatch`. Verify with a test where the global version differs and the web app keeps serving.
- [x] 3.5 Document the route, states, and codes in `docs/web-ui.md`, and verify `bun run format:check` passes.

## 4. Update button and dialog

- [x] 4.1 Add `UpdateButton.tsx` before the power button. It shows only when `update.available` is set and `canControl` is true, and its accessible name includes the version. Verify with `web/tests/update-button.spec.tsx` for shown, hidden with no update, and hidden for a remote caller.
- [x] 4.2 Add the dialog with both versions, the four host commands with copy actions, the note about OpenCode and Pi, and **Update web app**: disabled with a reason when `canInstall` is false, progress during `installing` and `restarting`, reload on a new instance, and the failure code on `failed`. Verify with component tests for each state and a clipboard test for one command.
- [x] 4.3 Add all new strings to `en`, `zh`, and `ar`, and verify `web/tests/directory-map-translations.spec.ts`-style key parity passes for the new keys.
- [x] 4.4 Describe the button and dialog in `docs/web-ui.md`, and add the web page path to `docs/upgrading.md` and `UPDATES.md`. Verify `bun run format:check` passes.

## 5. Integration

- [x] 5.1 Run `bun run ci:local` in this worktree, and verify it exits 0.
- [x] 5.2 Check the page in a browser at desktop and mobile widths in both themes: header colour and version, update button with a stubbed newer `latest`, and dialog layout. Verify with screenshots.
- [x] 5.3 Run `openspec validate web-header-version-and-update --strict`, and verify it reports no findings.
