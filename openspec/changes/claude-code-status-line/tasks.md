# Tasks

## 1. Check the plugin loads with a mod

- [ ] 1.1 Add `"modules": ["./omms-status.js"]` with a stub module to a copy of the plugin. Load it with `claude --plugin-dir` on the installed Claude Code (2.1.287 or later). In the stub, check that `$.plugin.root` is the plugin folder and that `$.process.run(["node", <root>/bin/omms-launch.mjs, "--at-least-own-version", "--version"])` prints a version. Verify: `claude plugin validate` passes, the stub reports the root and version, and the `SessionStart` command hook still runs.

## 2. Shared update logic

- [ ] 2.1 Move `latestNpmVersion` and `availableUpdate` to `src/services/update-check.ts`, and import them in `src/adapters/opencode/tui-status.ts`. Verify: `bun test tests/opencode-tui-status.test.ts` passes, and the boundary tests pass.

## 3. Status subcommand

- [ ] 3.1 Write `tests/claude-hook-status.test.ts`: `claude-hook status` prints `{ healthUrl, version, latest }`, where `version` is the running copy's version; gives `latest: null` when `OMMS_DISABLE_UPDATE_CHECK=1` or npm fails; and exits 0. Add a case in `tests/cli-handoff.test.ts` that `claude-hook status` from an older copy reports the newer recorded copy's version. Verify: both fail before 3.2.
- [ ] 3.2 Add a pure status builder in `src/adapters/claude-code/` (with `CONFIG` passed in) and the `status` event in `hook-command.ts`. Verify: 3.1 passes.

## 4. The mod

- [ ] 4.1 Write `hooks/omms-status.test.ts` for `claude plugin test`. It covers: `connected`; a 401 as `connected`; `web app off`; `not installed` when the launcher exits 1 and when `$.process.run` rejects; the launcher argv built from `$.plugin.root` with a 60-second timeout; `· <version> available`; no update for a prerelease; one toast per session that names `claude plugin update omms@omms`; and a copy with no `status` output falling back to the default health URL. Verify: it fails before 4.2.
- [ ] 4.2 Write `hooks/omms-status.js` and add `modules` to `hooks/hooks.json`. Keep the three launcher command hooks unchanged. Verify: `claude plugin validate .` passes and lists `session.start` and the `$.ui.status`, `$.ui.toast`, `$.http.fetch`, `$.process.run`, `$.clock.every` calls. `claude plugin test hooks` passes, and `bun test tests/claude-plugin-assets.test.ts` passes.
- [ ] 4.3 Make sure the npm package and its file checks still work with the new `hooks/` files. Verify: `bun run build`, then `bun run check:package` passes.

## 5. Docs

- [ ] 5.1 Update `docs/claude-code-adapter.md`, `UPDATES.md` and `docs/upgrading.md`: the status line, its states (`not installed` means the launcher could run no copy), the toast and its plugin update command (not `npm i -g`), the Claude Code 2.1.287 minimum, and `OMMS_DISABLE_UPDATE_CHECK`. Verify: `bun run check` passes (Prettier).

## 6. Verify

- [ ] 6.1 Run `bun run ci:local`. Verify: exit 0.
- [ ] 6.2 Live check in a real Claude Code session through Orca. Load the plugin with `--plugin-dir`, with no model prompt. See `omms: connected`. Stop the web app and see `omms: web app off` within 30 seconds, then start it again. Point the status JSON at a newer fake `latest` (test override) and see `· <version> available` and one toast that names `claude plugin update omms@omms`. Confirm the Orca status line still shows. Verify: record the screen text in the PR.
