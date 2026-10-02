# Tasks

## 1. Check the plugin loads with a mod

- [ ] 1.1 Add `"modules": ["./omms-status.js"]` with a stub module to a copy of the plugin. Load it with `claude --plugin-dir` on the installed Claude Code (2.1.287 or later). Verify: `claude plugin validate` passes and the `SessionStart` command hook still runs.

## 2. Shared update logic

- [ ] 2.1 Move `latestNpmVersion` and `availableUpdate` to `src/services/update-check.ts`, and import them in `src/adapters/opencode/tui-status.ts`. Verify: `bun test tests/opencode-tui-status.test.ts` passes, and the boundary tests pass.

## 3. Status subcommand

- [ ] 3.1 Write `tests/claude-hook-status.test.ts`: `claude-hook status` prints `{ healthUrl, version, latest }`, gives `latest: null` when `OMMS_DISABLE_UPDATE_CHECK=1` or npm fails, and exits 0. Verify: it fails before 3.2.
- [ ] 3.2 Add a pure status builder in `src/adapters/claude-code/` (with `CONFIG` passed in) and the `status` event in `hook-command.ts`. Verify: 3.1 passes.

## 4. The mod

- [ ] 4.1 Write `hooks/omms-status.test.ts` for `claude plugin test`. It covers `connected`, a 401 as `connected`, `web app off`, `not installed`, `· <version> available`, no update for a prerelease, one toast per session, and an old command with no `status` output. Verify: it fails before 4.2.
- [ ] 4.2 Write `hooks/omms-status.js` and add `modules` to `hooks/hooks.json`. Verify: `claude plugin validate .` passes and lists `session.start` and the `$.ui.status`, `$.ui.toast`, `$.http.fetch`, `$.process.run`, `$.clock.every` calls. `claude plugin test hooks` passes.
- [ ] 4.3 Make sure the npm package and its file checks still work with the new `hooks/` files. Verify: `bun run build`, then `bun run check:package` passes.

## 5. Docs

- [ ] 5.1 Update `docs/claude-code-adapter.md`, `UPDATES.md` and `docs/upgrading.md`: the status line, its states, the toast, the Claude Code 2.1.287 minimum, and `OMMS_DISABLE_UPDATE_CHECK`. Verify: `bun run check` passes (Prettier).

## 6. Verify

- [ ] 6.1 Run `bun run ci:local`. Verify: exit 0.
- [ ] 6.2 Live check in a real Claude Code session through Orca. Load the plugin with `--plugin-dir`, with no model prompt. See `omms: connected`. Stop the web app and see `omms: web app off` within 30 seconds, then start it again. Point the status JSON at a newer fake `latest` (test override) and see `· <version> available` and one toast. Confirm the Orca status line still shows. Verify: record the screen text in the PR.
