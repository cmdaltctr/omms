# Proposal

## Why

Three parts of OMMS run the global `om-memory-system` install: the terminal command, the Claude Code hooks, and the web app login item. Only `npm i -g om-memory-system@latest` updates that install. `opencode plugin update`, `pi update`, and the Claude Code plugin auto-update do not touch it. Users forget the manual step, so old code keeps running. On the maintainer's machine, OpenCode and Pi run 4.3.2, the Claude Code plugin is 4.3.3, and the global command, the hooks, and the web app still run 4.3.0.

Each host also rewrites the login item when it starts a newer copy, but the running web app does not restart. The new version only loads at the next login.

## What Changes

- OMMS keeps a machine-wide record of the newest OMMS copy, `~/.omms/runtime.json`. Each OpenCode start, each Pi start, and each run of the terminal command records its own copy when that copy is newer than the record and valid.
- A small launcher script with no dependencies, `bin/omms-launch.mjs`, finds the newest valid copy (from the record, the global install, and the launcher's own copy) and runs its `om-memory-system` command. The newest copy places this launcher at `~/.omms/bin/omms-launch.mjs`.
- The login item runs the launcher in `~/.omms/bin/` instead of a fixed package path, so it always starts the newest copy.
- The terminal command hands off to the newest copy. When the record names a newer valid copy, an old global install runs that copy's command with the same arguments, input, and exit code.
- When a host starts and the running web app is older than the newest copy, the host asks that web app to step aside and starts the newest copy. This uses the step-aside route that `web install` already uses.
- The Claude Code hooks run `node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version claude-hook <event>`. When no local copy is at least the plugin's version, the launcher runs `npx --yes om-memory-system@<plugin version>`. The global install becomes optional for Claude Code. **BREAKING** for users who copied the hook entries into their settings by hand: the old entries keep working, but they do not get the new behaviour until they change the entries.
- `OMMS_NO_HANDOFF=1` turns the hand-off off for one process, for debugging and rollback.
- The Settings page's **Web app** section reads the global install's version from its `package.json` instead of running `--version`. When a newer copy runs in its place, it says that the global install is optional and out of date.

## Capabilities

### New Capabilities

- `omms-runtime`: the newest-copy record, the launcher, the hand-off from the terminal command, and the rules that make an old copy run the newest code.

### Modified Capabilities

- `web-autostart`: the login item runs the launcher. A host start replaces an older running web app. The "newest OMMS copy" requirement moves to the record. The Settings page reads the global version from the package files.
- `claude-code-adapter`: hooks run through the plugin's launcher, fall back to `npx` at the plugin version, and no longer need a global install.

## Impact

- New: `bin/omms-launch.mjs` (plain ES module, Node built-ins only), `src/services/runtime-record.ts`, and tests for both.
- Changed: `src/services/web-autostart.ts`, `src/services/web-ensure.ts`, `src/cli/index.ts`, `src/cli/web-command.ts` (the step-aside handover moves to a shared service), `src/services/global-version.ts`, `src/index.ts`, `src/adapters/pi/extension.ts`, `hooks/hooks.json`, `.claude-plugin/plugin.json`, `package.json` (`files` adds `bin`).
- Docs: `docs/upgrading.md`, `docs/claude-code-adapter.md`, `docs/cli.md`, `docs/web-ui-settings.md`, `UPDATES.md`, `README.md` (the global install becomes optional), and a new ADR.
- Overlap with the active change `claude-code-status-line` (on its own branch): both edit `hooks/hooks.json`, and its update notice compares against the global install. Whichever change merges second must rebase. The status line command should run through the launcher too.
- No store, schema, or config key changes.
