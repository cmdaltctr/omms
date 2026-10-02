# Proposal

## Why

OpenCode and Pi show OMMS's state and a newer-release notice while you work. Claude Code shows nothing. A Claude Code user cannot see that the web app is off. They also do not learn that the global `om-memory-system` command is out of date, and the plugin's hooks run that command. Claude Code 2.1.287 added plugin mods, which can show a status line and a toast, so the gap can now close.

## What Changes

- The OMMS Claude Code plugin gains a mod: a hooks module listed under `modules` in `hooks/hooks.json`. The existing command hooks stay under `hooks` in the same file.
- The mod shows one status line under the prompt:
  - `connected` when the web app answers its health route
  - `web app off` when it does not
  - `not installed` when `om-memory-system` cannot run
  - `· <version> available` added when npm has a newer stable release than the global command
- The mod shows one toast per session for a newer release. The toast names the update command, `npm i -g om-memory-system@latest`.
- A new subcommand, `om-memory-system claude-hook status`, prints JSON with the web app's health URL, the installed version, and npm's `latest` version. It reuses the OpenCode footer's version and npm logic. `OMMS_DISABLE_UPDATE_CHECK=1` turns off the npm lookup.
- The mod checks the health URL every 30 seconds and runs the subcommand at session start and every 6 hours, the same timing as the OpenCode footer.
- Docs: `docs/claude-code-adapter.md`, `UPDATES.md`, and `docs/upgrading.md` describe the status line and the notice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: the plugin is no longer only hooks and a skill. It also holds a mod. New requirements cover the status line and the newer-release notice.

## Impact

- New files: `hooks/omms-status.js` (the hooks module) and its `claude plugin test` file. Only `claude plugin test` runs that test. `scripts/run-tests-isolated.sh` runs only `tests/*.test.ts` and `web/tests/*.spec.ts(x)`.
- Changed: `hooks/hooks.json`, `src/adapters/claude-code/hook-command.ts` (new `status` event), a new pure module for the status JSON, and tests in `tests/`.
- Shared logic: `availableUpdate` and `latestNpmVersion` move from `src/adapters/opencode/tui-status.ts` into `src/services/`, so the Claude Code adapter does not import the OpenCode adapter.
- The plugin requires Claude Code 2.1.287 or later. Older versions are not supported.
- No new dependencies. The npm lookup sends no session content.
