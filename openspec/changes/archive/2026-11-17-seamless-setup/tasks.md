# Tasks

Build order: group 1 first. Groups 2 to 7 can then run in parallel; each owns the files listed under it and touches no other group's files. Group 8 runs last. Every test uses a scratch home, a scratch `PATH` with fake host binaries (Node scripts, plus a `.cmd` shim on Windows) and no system folders. No test calls a real `opencode`, `pi` or `claude`, or reads the real `~/.omms` or `~/.config`. Write each test first and confirm it fails before the code exists.

## 1. Shared pure modules

Owns: `src/core/host-setup.ts`, `src/services/find-program.ts`, `src/services/first-run-notice.ts`, `src/services/web-start-notice.ts`, `src/services/claude-capture-state.ts`, `src/services/health-body.ts`, `src/services/web-ensure.ts` (export only), and their tests.

- [x] 1.1 `tests/find-program.test.ts`: finds a fake binary on a scratch `PATH`, honours `PATHEXT` on `win32`, searches the given extra folders, returns null when absent, and never looks outside the folders it is given.
- [x] 1.2 `tests/first-run-notice.test.ts`: lines per host from a config argument (history import, login item for OpenCode and Pi only, embedding download); a part that is off is left out; `claimNotice` returns true once per key, survives a missing or broken record file, writes atomically in the folder it is given; clearing a key lets it be claimed again.
- [x] 1.3 `tests/web-start-notice.test.ts`: text for `port-busy` names the port and the fix; `no-runtime` names Node 22.14; `running`, `started`, `disabled` and `start-timeout` give null.
- [x] 1.4 `tests/claude-capture-state.test.ts`: `off` when `autoCaptureEnabled` is false, `ready` with a complete external API, `needs-setup` with a missing key, model or URL.
- [x] 1.5 `tests/health-body.test.ts`: the body keeps `success`, `status`, `authEnabled`, `instance`, and adds `claudeCapture`.
- [x] 1.6 Write `src/core/host-setup.ts` (types: `HostSetup`, `HostFacts`, `SetupStep`, `DoctorRow`), then the five modules. None imports `CONFIG`.
- [x] 1.7 Export the `/api/health` probe from `web-ensure.ts` (no behaviour change).

## 2. Setup command and host setup objects

Owns: `src/cli/index.ts`, `src/cli/setup-command.ts`, `src/cli/host-setups.ts`, `src/adapters/opencode/setup.ts`, `src/adapters/pi/setup.ts`, `src/adapters/claude-code/setup.ts`, `src/adapters/opencode/self-update.ts`, `src/adapters/pi/self-update.ts`, and their tests.

- [x] 2.1 `tests/opencode-setup.test.ts`: registered when the global `opencode.json` or `opencode.jsonc` (under `XDG_CONFIG_HOME` or the scratch home) lists `om-memory-system` in any form; the `cli.json` merge keeps other keys, entries and comments, adds `plugins` when absent, leaves a versioned entry alone, never creates a missing file, and refuses a broken file or a non-array `plugins`.
- [x] 2.2 `tests/pi-setup.test.ts`: registered when Pi `settings.json` (honouring `PI_CODING_AGENT_DIR`) lists `npm:om-memory-system` with or without a version.
- [x] 2.3 `tests/claude-code-setup.test.ts`: registered when the fake `claude plugin list` prints `omms@omms`; the marketplace step is skipped when `claude plugin marketplace list` prints `omms`; next step names the External API link only when capture is not ready.
- [x] 2.4 `tests/cli-setup.test.ts` with fake binaries that record their arguments: plan output lists found, already set up and absent hosts and the first-run notice; `--dry-run` runs nothing; a "no" answer runs nothing; a pipe without `--yes` exits 1 and runs nothing; `--yes` runs the exact install commands; a second run runs no install command; a failing fake `pi` does not stop OpenCode and gives exit 1; no host found gives exit 1; a version below the minimum warns in the plan.
- [x] 2.5 Add the install commands next to the update commands in each adapter's `self-update.ts`; export `readPiSettings`.
- [x] 2.6 Write the three adapter `setup.ts` files and `src/cli/host-setups.ts`.
- [x] 2.7 Write `src/cli/setup-command.ts`: detect, plan, ask (`node:readline`, default no), run steps synchronously with the self-update spawn options, print results and next steps.
- [x] 2.8 `src/cli/index.ts`: dispatch `setup` and `doctor` (lazy imports) and add both to the usage text.

## 3. Doctor command and health row fields

Owns: `src/cli/doctor-command.ts`, `src/cli/doctor-rows.ts`, `src/importer/settings-health.ts`, and their tests.

- [x] 3.1 `tests/settings-health-host-field.test.ts`: OpenCode, Pi and Claude Code rows carry `host`; failing rows carry a plain `fix`; existing row names and statuses do not change.
- [x] 3.2 `tests/cli-doctor.test.ts` with fake binaries and a stub web app on a free port: Node row; host version rows against the minimums; absent hosts give no rows; registered rows; the `cli.json` row; web app rows for OMMS, another program (port named) and nothing; health rows fetched with the local token and filtered by `host`; skipped rows with the start fix when the web app is down; `--json` prints one array and nothing else on standard output; `--skip-model-test` sends `testModels: false`; exit 1 on any failed row; no API key in any output.
- [x] 3.3 Add `host` and `fix` to `HealthRow` and fill them in `settings-health.ts`.
- [x] 3.4 Write `doctor-rows.ts` (pure: facts in, rows out) and `doctor-command.ts` (detection, probe, health fetch, table or JSON).

## 4. Claude Code: capture-off label, setup line, port-busy

Owns: `src/adapters/claude-code/hook-client.ts`, `src/importer/claude-hook-api.ts`, `hooks/omms.jsx`, `hooks/omms-status.jsx`, `hooks/omms-status-glyphs.js`, `src/services/status-glyphs.ts`, `src/services/web-server.ts` (health block only), and their tests.

- [x] 4.1 `tests/claude-hook-client.test.ts`: `port-busy` from the start rule logs `port-busy` (fails on the old code, which logs `server-unreachable`); `no-runtime` still logs `server-unreachable`; at `SessionStart` both write one JSON line with a `systemMessage` and nothing else on standard output; prompt and stop hooks write no `systemMessage`; a retrieve answer with `systemMessage` and empty `additionalContext` still writes one JSON line; requests carry `notices: true`.
- [x] 4.2 `tests/claude-hook-api.test.ts`: `SessionStart` with `notices: true` returns the first-run notice once and the capture setup line once while capture needs setup; a ready capture clears the setup key; a request without `notices` claims nothing; the notice never appears in `additionalContext`.
- [x] 4.3 `tests/status-glyphs.test.ts` and `tests/status-glyph-parity.test.ts`: `capture off` gives `omms: ✔ capture off` in both twins.
- [x] 4.4 `hooks/omms-status.test.ts` (run with `bash scripts/test-claude-mod.sh`): health with `claudeCapture: "needs-setup"` shows `capture off` in the warning colour; `ready`, `off` and a missing field show `connected`.
- [x] 4.5 Replace the inline `/api/health` body in `web-server.ts` with `healthBody(...)`; lower the ceiling entry in `tests/file-size-ceiling.test.ts` if the file shrinks.
- [x] 4.6 Implement the hook changes (`port-busy` code, `systemMessage` output, `notices` flag) and the retrieve answer's `systemMessage`.
- [x] 4.7 Implement the label state in the mod and the glyph twins.

## 5. Pi and OpenCode notices

Owns: `src/adapters/pi/extension.ts`, `src/v2/startup.ts`, `src/adapters/opencode/tui-status.ts`, `opencode/tui.tsx`, and their tests.

- [x] 5.1 `tests/pi-extension.test.ts`: a `port-busy` and a `no-runtime` start result each give one warning notification per process; `running` gives none; the first session shows the first-run notice once, the second does not; no notification without an interface.
- [x] 5.2 `tests/opencode-web-ensure.test.ts`: OpenCode uses the shared wording for both results.
- [x] 5.3 `tests/opencode-tui-status.test.ts`: the terminal interface claims and shows the first-run notice once.
- [x] 5.4 Implement. Keep `extension.ts` under 500 lines; move code into a new Pi module if needed.

## 6. Welcome panel

Owns: `web/src/lib/components/explorer/WelcomePanel.tsx`, `web/src/lib/components/explorer/MemoryList.tsx`, `web/src/lib/i18n/welcome.ts`, `web/src/lib/i18n/translations.ts` (one import line), and their tests.

- [x] 6.1 Load the `omms-design` skill and read `web/CLAUDE.md`.
- [x] 6.2 `web/tests/welcome-panel.spec.tsx`: shows with total 0 and no filter; hides with memories or a filter; one line per host from `effective` ("Ready" or "Needs setup" with the reason); the External API link targets `/settings#settings-section-external-api`; a failed settings request hides only the host list.
- [x] 6.3 Build the panel with the shared card and `Button` patterns; mount it in the `MemoryList` empty branch.
- [x] 6.4 Add the strings in English, Chinese and Arabic; `tests/web-translations-parity.test.ts` passes.

## 7. Docs

Owns: `README.md`, `UPDATES.md`, `package.json` (description only), `docs/cli.md`, `docs/claude-code-adapter.md`, `docs/opencode-adapter.md`, `docs/pi-adapter.md`, `docs/web-ui.md`, `docs/web-ui-memory.md`, `docs/configuration.md`.

- [x] 7.1 README: `npx om-memory-system@latest setup` first; then per-host install with minimum versions (Node 22.14, OpenCode 2.0.22, Claude Code 2.1.295, Pi 0.86.1); a "check it works" step with `npx om-memory-system@latest doctor`.
- [x] 7.2 `docs/cli.md`: `setup` and `doctor` sections, flags, exit codes; `npx` forms.
- [x] 7.3 `docs/claude-code-adapter.md`: `capture off` label, setup line, `port-busy` row, `server-unreachable` advice, `npx` forms at the lines the audit lists (269, 410, 650, 652), and the reload step (the `memory` tool needs a new session).
- [x] 7.4 `docs/opencode-adapter.md`: `cli.json` merge rule and why `setup` never creates the file; uninstall section (`opencode plugin remove om-memory-system`, the `cli.json` entry, `"webServerAutoStart": false` then `npx om-memory-system@latest web uninstall`).
- [x] 7.5 `docs/pi-adapter.md`: web-start notice; uninstall section (`pi remove npm:om-memory-system`, then the login item as above). Check the Pi remove command name against `pi --help` output recorded in the docs or Pi's README before writing it.
- [x] 7.6 `docs/web-ui.md:12`: the login item is on by default for OpenCode and Pi; turn it off with `"webServerAutoStart": false`. `docs/web-ui-memory.md`: the welcome panel. `docs/configuration.md:59-60`: comment out the `opencodeProvider` and `opencodeModel` example lines.
- [x] 7.7 `UPDATES.md`: Claude Code row says OMMS updates the plugin at session start, label `omms: ✔`. `package.json` description names Claude Code.
- [x] 7.8 Measure the embedding model download size once in a scratch home and state it in the first-run notice docs.

## 8. Verification

- [x] 8.1 Mutation check: break the `cli.json` merge, the `port-busy` mapping and the notice claim in turn; the matching tests fail.
- [x] 8.2 Focused tests: `bash scripts/run-tests-isolated.sh tests/<file>.test.ts` for each new and changed test file; `bash scripts/test-claude-mod.sh`.
- [x] 8.3 `bun run check` exits 0.
- [x] 8.4 `bun run build` exits 0, then `bun run check:package` exits 0.
- [x] 8.5 Live check in a scratch home with fake host binaries on a free port: `node dist/cli/index.js setup --dry-run`, `setup --yes` twice, `doctor`, `doctor --json`.
- [x] 8.6 Live check of the Claude Code `systemMessage` and amber label in a real Claude Code 2.1.295+ session with a scratch home and no external API (see the owner's notes on scratch home and Keychain). If the line does not show, apply the toast fallback from the design and record a TDR. Evidence: passed on Claude Code 2.1.326 in a scratch home; the session-start line showed, and the label cleared about 7 seconds after an external API was saved (evidence in the run's scratch folder).
- [x] 8.7 Browser check of the welcome panel at desktop width and at 390 px, light and dark, in English and Arabic. Also check that a project filter with no rows keeps the plain "No memories found" line: no unit test covers the 390 px layout or the `activeTag` wiring in `App.tsx`. Evidence: passed at 1280 and 390 px in English, Chinese and Arabic, light and dark (evidence in the run's scratch folder).
- [x] 8.8 `bun run ci:local` exits 0. (2026-11-17, after the live-check fixes: exit 0, 603 test files, 5,328 tests passed, 0 failed. The run before it had one failure in the unchanged `tests/embedding-server-key.test.ts`, a 403 from its random-port test server; that file passed 5 of 5 times alone.)
- [x] 8.9 `openspec validate seamless-setup --strict`, then the verify and archive steps before the pull request. (2026-11-17: validate passes on the combined branch `feat/modularity-and-onboarding`; the change is archived there with the other four.)

## 9. Review fixes

- [x] 9.1 `doctor`: a model test the web app cannot run because the host uses its own model is `skipped` with no fix (`hostModelOnly` on the health row). Test with the real health rows for a default Pi and a default OpenCode user (`tests/cli-doctor.test.ts`, `tests/real-health-rows.ts`).
- [x] 9.2 `cli.json` write: merge again inside `apply()`, write through a symbolic link, keep the file mode, never create the file (`tests/opencode-setup.test.ts`).
- [x] 9.3 Claude Code user lines are recorded only after the hook confirms them with `POST /api/claude/notices` (`tests/claude-hook-client.test.ts`, `tests/claude-hook-api.test.ts`).
- [x] 9.4 `doctor` health request failure: plain reason, Run checks fix, Basic Auth sent (`tests/cli-doctor.test.ts`).
- [x] 9.5 Missing `cli.json` fix no longer says to create the file.
- [x] 9.6 Plain setting words shared by the hook line and the welcome panel (`src/shared/setting-words.ts`, `tests/setting-words.test.ts`); no restart step for an unchanged host (`tests/cli-setup.test.ts`, `tests/claude-code-setup.test.ts`); main help lists `--skip-model-test`.
- [x] 9.7 The secret test puts the marker in the saved config keys and the health error text; the regex check over `App.tsx` and the false 390 px check are removed (covered by 8.7).
- [x] 9.8 Four small issues (score 3 or below) listed in `proposal.md` under "Known small issues".
