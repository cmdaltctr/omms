# Tasks

## 1. Decision record

- [x] 1.1 Review `docs/adr/014-one-shared-web-app-for-every-host.md` (drafted with this proposal) against the final design, and confirm its row in `docs/adr/ADR_README.md`. Verify: `bun run format:check` passes on both files.

## 2. Shared start module

- [x] 2.1 Write failing tests in `tests/web-ensure.test.ts` with injected fetch, spawn, sleep, clock, file system, and pid check: returns `running` and spawns nothing when OMMS answers; returns `disabled` when `webServerEnabled` is `false`; returns `port-busy` and spawns nothing when a non-OMMS reply answers; spawns exactly one detached `om-memory-system web` when nothing answers. Verify: tests fail before the module exists.
- [x] 2.2 Write failing tests for the lock: ten parallel callers with no web app spawn exactly one process; a lock whose pid is dead is taken over; a lock older than 20 seconds is taken over; a caller without the lock never spawns and returns once health answers; `wait: false` returns before health answers. Verify: tests fail before the lock exists.
- [x] 2.3 Implement `src/services/web-ensure.ts` (design decision 1). Pass config as an argument. Import nothing from `src/adapters/`. Verify: 2.1 and 2.2 pass, and each guard fails its test when removed.
- [x] 2.4 Write a real-process test: start two `ensureWebApp` callers at once against the built package on a spare port in a temp HOME, and confirm one web app answers and one process listens. Verify: passes after `bun run build`.

## 3. Host calls

- [x] 3.1 Claude Code: make `ensureServer` in `src/adapters/claude-code/hook-client.ts` call `ensureWebApp` and map its result to the existing codes. Remove the private spawn and poll code. Verify: `tests/claude-hook-client.test.ts` passes unchanged, or with only the injected-dependency seam updated, and no test is weakened.
- [x] 3.2 Pi: call `ensureWebApp({ wait: false })` in `session_start` next to `reconcileWebAutostart`, under the same guard. Write a failing test in `tests/pi-extension.test.ts` that a Pi start with no web app calls it once and the session start does not wait for it. Verify: passes.
- [x] 3.3 OpenCode: replace the `startWebServer` block in `src/index.ts` with `ensureWebApp` and one toast (design decision 2). Keep `registerOpencodeImportModels` and the OpenCode retry drain. Write a failing test that an OpenCode start calls `ensureWebApp` and creates no `WebServer`. Verify: passes.
- [x] 3.4 Find every test that expects the OpenCode plugin to start a web server (start with `tests/opencode-trace-startup.test.ts`, `tests/opencode-backfill-startup.test.ts`, `tests/profile-tool-runtime.test.ts`, `tests/compaction-agent-preservation.test.ts`). Update each one to the new behaviour without weakening what it checks. Verify: each passes, and record the list in the change notes.
- [x] 3.5 Run `tests/host-neutral-capture-boundary.test.ts`, `tests/pi-adapter-boundary.test.ts`, `tests/claude-code-adapter-boundary.test.ts`, and `tests/plugin-bundle-boundary.test.ts`. Verify: all pass, and `web-ensure.ts` is loaded with dynamic `import()` from the plugin.
- [x] 3.6 Remove the web-port owner check from OpenCode `session.idle`, so profile learning and daily cleanup run in every session (design decision 2). Verify: `tests/opencode-web-ensure.test.ts` passes, and fails when the check returns.

## 4. Page changes for OpenCode's models

- [x] 4.1 Write failing tests for the Import readiness reason: with no OpenCode host models, the reason names the terminal and `/import` in OpenCode, and only the external API is offered. Then change `src/importer/import-readiness.ts` and the Import section text. Verify: tests pass.
- [x] 4.2 Write a failing test that the Health page reports the OpenCode model test as skipped (or warn, per design decision 3) with the reason, not fail, when no OpenCode host models exist. Then change `src/importer/settings-health.ts` and the Health view. Verify: test passes, and record the chosen status in the change notes.

## 5. Power control routes

- [x] 5.1 Write failing tests in `tests/web-power-control.test.ts`: `GET /api/web/status` returns the version and `canControl` (true for a loopback peer, false otherwise, `401` without a token); `POST /api/web/stop` and `/restart` return `401` without a token, `403` from a non-loopback address, `409` without a callback, and `202` with the callback run after the reply; one log record per request with no token. Verify: tests fail before the routes exist.
- [x] 5.2 Implement the routes and `setOnPowerAction` in `src/services/web-server.ts` (design decision 4), and remove the start lock when the server becomes owner and the lock names its pid. Verify: 5.1 passes, and each guard fails its test when removed.

## 6. Stop and Restart in the standalone command

- [x] 6.1 Add the login-item restart command to `src/services/web-autostart.ts` (`launchctl kickstart -k`, `systemctl --user restart`). Write the failing test first with a fake runner for both platforms. Verify: passes, and fails when the command changes.
- [x] 6.2 Register the power callback in `src/cli/web-command.ts` (design decision 5), with an injected spawn. Write failing tests: Stop exits `0`; Restart with `--login-item` runs the service-manager command and falls back to the detached copy when it fails; Restart without it spawns a detached copy and writes the start lock with the copy's pid. Verify: tests pass.
- [x] 6.3 Write a real-process test in the style of `tests/web-standalone-step-aside.test.ts`: start the built standalone app on a spare port, call `POST /api/web/restart`, and confirm a new pid answers on the same port and the old process exited; then call `POST /api/web/stop` and confirm exit code `0`. Verify: passes after `bun run build`, and fails when the callback is removed.

## 7. Web page

- [x] 7.1 Add the power button, dialog, stopped-screen, and note keys to `web/src/lib/i18n/translations.ts` for `en`, `zh`, and `ar`. Verify: the translation parity test and `bun run typecheck` pass.
- [x] 7.2 Write failing tests in `web/tests/` (style of `language-menu-interactions.spec.tsx`): no button when `canControl` is false; green on success and grey on failure; dialog focuses Restart; closing sends no request; each choice sends the matching `POST` with the token header; the dialog and stopped screen show the "next host start brings it back" note. Verify: tests fail before the component exists.
- [x] 7.3 Implement `PowerButton` and the dialog under `web/src/lib/components/explorer/`, add it to the footer in `AppSidebar.tsx`, and add the stopped screen and restart wait (design decision 6). Verify: 7.2 passes and `bun run web:build` passes.
- [x] 7.4 Check the page in a browser: green button, dialog, Restart reloads, Stop shows the stopped screen, the Import and Health changes, in `en`, `zh`, and `ar` (right-to-left). Verify: record what you saw in the change notes.

## 8. Documentation

- [x] 8.1 Update `docs/web-ui.md` (one shared web app, which hosts start it, the power button, a stop lasts until the next host start, a restart by hand loses the terminal) and `docs/web-ui-settings.md` (Import and Health behaviour). Verify: `bun run check` passes.
- [x] 8.2 Update `docs/opencode-adapter.md` (OpenCode no longer runs the page in-process; what that changes), `docs/pi-adapter.md` (Pi starts the web app), `docs/claude-code-adapter.md` (the hook uses the shared start rule; set `webServerEnabled` to `false` to keep the app off), and `docs/cli.md` (how to start the app again). Verify: `bun run check` passes.
- [x] 8.3 Record the OpenCode profile learning and cleanup decision in `docs/adr/014-one-shared-web-app-for-every-host.md` (Decision, Consequences, Alternatives), and in `docs/opencode-adapter.md` (`session.idle` row and Limitations). Verify: `bun run check` passes.

## 9. Release check

- [x] 9.1 Run `bun run ci:local`. Verify: passes.
- [x] 9.2 On macOS in a temp HOME with a spare port: start OpenCode-style, Pi-style, and hook-style callers at once and confirm one web app; press Restart and Stop in the page and confirm a new process, then an exit; start a host again and confirm the app returns. Do not touch the real login item. Verify: record the output in the change notes.
- [ ] 9.3 Hold the release-please PR until this change merges, and confirm the release notes list both `web-version-handover` and this change for the same version. Verify: both appear.
- [x] 9.4 Run the web page specs in `web/tests/` from `scripts/run-tests-isolated.sh` with `--tsconfig-override web/tsconfig.app.json`, and describe it in `docs/ci.md` and `CONTRIBUTING.md`. Verify: `bash scripts/run-tests-isolated.sh` runs the four specs, and exits non-zero when a spec fails.
