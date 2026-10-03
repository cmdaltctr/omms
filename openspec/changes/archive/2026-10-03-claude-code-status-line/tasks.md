# Tasks

## 1. Check the plugin loads with a mod

- [x] 1.1 Add `"modules": ["./omms-status.js"]` with a stub module to a copy of the plugin. Load it with `claude --plugin-dir` on the installed Claude Code (2.1.287 or later). In the stub, check that `$.plugin.root` is the plugin folder and that `$.process.run(["node", <root>/bin/omms-launch.mjs, "--at-least-own-version", "--version"])` prints a version. Also run a command that sleeps past a short `timeoutMs`, and a command that does not exist, and record the two rejection errors: can the mod tell "timed out" from "cannot start"? Record the answer in design.md decision 2. Verify: `claude plugin validate` passes, the stub reports the root and version and both errors, and the `SessionStart` command hook still runs.

## 2. Shared update logic

- [x] 2.1 Move `latestNpmVersion` and `availableUpdate` to `src/services/update-check.ts`, and import them in `src/adapters/opencode/tui-status.ts`. `tests/opencode-tui-status.test.ts:3` imports both from `tui-status.ts`: re-export them there, or point the test import at the new module. Do not remove or weaken any assertion. Verify: `bun test tests/opencode-tui-status.test.ts` passes, and the boundary tests pass.

## 3. Status subcommand

- [x] 3.1 Write `tests/claude-hook-status.test.ts`: `claude-hook status` prints `{ healthUrl, version, latest }`, where `version` is the running copy's version; gives `latest: null` when `OMMS_DISABLE_UPDATE_CHECK=1` or npm fails; and exits 0. Add a case in `tests/cli-handoff.test.ts` that `claude-hook status` from an older copy reports the newer recorded copy's version. Verify: both fail before 3.2.
- [x] 3.2 Add a pure status builder in `src/adapters/claude-code/` (with `CONFIG` passed in) and the `status` event in `hook-command.ts`. Verify: 3.1 passes.

## 4. The mod

- [x] 4.1 Write `hooks/omms-status.test.ts` for `claude plugin test`. It covers: `connected`; a 401 as `connected`; `web app off`; `not installed` when the launcher exits 1; a `$.process.run` timeout keeps the health-only state with no update and does not show `not installed`; a start failure follows the 1.1 finding; the launcher argv built from `$.plugin.root` with a 60-second timeout; `· <version> available`; no update for a prerelease; one toast per session that names `claude plugin update omms@omms`; and a copy with no `status` output falling back to the default health URL. Also extend `tests/claude-plugin-assets.test.ts`: `hooks/hooks.json` has `"modules": ["./omms-status.js"]`, the three launcher hooks stay as they are, and the file still has no version number. Verify: both fail before 4.2.
- [x] 4.2 Write `hooks/omms-status.js` and add `modules` to `hooks/hooks.json`. Keep the three launcher command hooks unchanged. Verify: `claude plugin validate .` passes and lists `session.start` and the `$.ui.status`, `$.ui.toast`, `$.http.fetch`, `$.process.run`, `$.clock.every` calls. `bash scripts/test-claude-mod.sh` passes (`claude plugin test` runs every `*.test.ts` under a plugin folder, so the script builds a small plugin folder from the module and its test; `claude plugin test hooks` and `claude plugin test .` both fail), `bun test tests/claude-plugin-assets.test.ts` passes, and `bun run check` passes (ESLint covers `hooks/`).
- [x] 4.3 Make sure the npm package and its file checks still work with the new `hooks/` files. Verify: `bun run build`, then `bun run check:package` passes.

## 5. Docs

- [x] 5.1 Update `docs/claude-code-adapter.md`, `UPDATES.md` and `docs/upgrading.md`: the status line, its states (`not installed` means the launcher could run no copy), the toast and its plugin update command (not `npm i -g`), the Claude Code 2.1.287 minimum, and `OMMS_DISABLE_UPDATE_CHECK`. Verify: `bun run check` passes (Prettier).

## 6. Verify

- [x] 6.1 Run `bun run ci:local`. Verify: exit 0.
- [x] 6.2 Live check in a real Claude Code session through Orca. Load the plugin with `--plugin-dir`, with no model prompt. See `omms: connected`. Stop the web app and see `omms: web app off` within 30 seconds, then start it again. Point the status JSON at a newer fake `latest` (test override) and see `· <version> available` and one toast that names `claude plugin update omms@omms`. Confirm the Orca status line still shows. Verify: record the screen text in the PR.

  Live check, 2026-10-03, Claude Code 2.1.288 in an Orca terminal, no model prompt. Screen text (the `⚠` is how Claude Code draws a plugin status line):

  - Real plugin (`--plugin-dir` on the repository), real launcher, real web app on port 4747: `⚠ omms: connected`.
  - Same module with a stub launcher that printed `{"healthUrl":"http://127.0.0.1:4799/api/health","version":"4.3.3","latest":"9.9.9"}`, nothing on port 4799: `⚠ omms: web app off · 9.9.9 available`, and one toast: `OMMS 9.9.9 available. Run: claude plugin update omms@omms, /reload-plugins`.
  - A throwaway health server then started on port 4799: within one 30-second poll the line read `⚠ omms: connected · 9.9.9 available`, and no second toast appeared.
  - The Orca status script (`statusLine` in `~/.claude/settings.json`) prints nothing on screen by design, so no line from it is visible. It was not replaced.

  Deviations from the plan: the login-item web app on port 4747 was not stopped, because other sessions use it. The off and on-again states used a throwaway port with the stub launcher instead, and the update notice used the stub launcher in place of a `latest` test override, which does not exist.
