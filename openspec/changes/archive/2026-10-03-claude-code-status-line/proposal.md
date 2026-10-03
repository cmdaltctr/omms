# Proposal

## Why

OpenCode and Pi show OMMS's state and a newer-release notice while you work. Claude Code shows nothing. A Claude Code user cannot see that the web app is off. They also do not learn that the OMMS version their hooks run is behind npm. Claude Code 2.1.287 added plugin mods, which can show a status line and a toast, so the gap can now close.

This change builds on `newest-copy-runtime` (merged in #79). The hooks now run the plugin's launcher, `bin/omms-launch.mjs`, which runs the newest local OMMS copy or `npx` at the plugin's version. The global install is optional.

## What Changes

- The OMMS Claude Code plugin gains a mod: a hooks module listed under `modules` in `hooks/hooks.json`. The existing command hooks, which run the launcher, stay under `hooks` in the same file.
- The mod shows one status line under the prompt:
  - `connected` when the web app answers its health route
  - `web app off` when it does not
  - `not installed` when the plugin's launcher can run no OMMS copy
  - `· <version> available` added when npm has a newer stable release than the OMMS version the launcher runs
- The mod shows one toast per session for a newer release. The toast names the plugin update: `claude plugin update omms@omms`, then `/reload-plugins`.
- A new subcommand, `om-memory-system claude-hook status`, prints JSON with the web app's health URL, the running version, and npm's `latest` version. It reuses the OpenCode footer's version and npm logic. `OMMS_DISABLE_UPDATE_CHECK=1` turns off the npm lookup.
- The mod runs the subcommand through the launcher: `node <plugin root>/bin/omms-launch.mjs --at-least-own-version claude-hook status`. It finds the plugin root with `$.plugin.root`.
- The mod checks the health URL every 30 seconds and runs the subcommand at session start and every 6 hours, the same timing as the OpenCode footer.
- Docs: `docs/claude-code-adapter.md`, `UPDATES.md`, and `docs/upgrading.md` describe the status line and the notice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: the plugin is no longer only hooks, a launcher, and a skill. It also holds a mod. New requirements cover the status line and the newer-release notice.

## Impact

- Depends on `newest-copy-runtime` (merged in #79): `bin/omms-launch.mjs`, `--at-least-own-version`, and the command hand-off in `runCli`.
- New files: `hooks/omms-status.js` (the hooks module) and its `claude plugin test` file. Only `claude plugin test` runs that test. `scripts/run-tests-isolated.sh` runs only `tests/*.test.ts` and `web/tests/*.spec.ts(x)`.
- Changed: `hooks/hooks.json` (adds `modules`; the launcher commands stay as they are), `src/adapters/claude-code/hook-command.ts` (new `status` event), a new pure module for the status JSON, and tests in `tests/`.
- Shared logic: `availableUpdate` and `latestNpmVersion` move from `src/adapters/opencode/tui-status.ts` into `src/services/`, so the Claude Code adapter does not import the OpenCode adapter.
- The plugin requires Claude Code 2.1.287 or later. Older versions are not supported.
- No new dependencies. The npm lookup sends no session content.
