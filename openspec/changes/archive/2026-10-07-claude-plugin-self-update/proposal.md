## Why

After 4.13.0 was approved, a restarted Claude Code session kept the 4.12.0 plugin. Claude Code's own marketplace update pass runs at its own time, after the first message with a random delay, and had not refreshed since before `stable` moved. Pi and OpenCode showed the update at once.

## What Changes

- At session start, OMMS reads the plugin's version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and compares it with npm `latest`.
- When the plugin is older, OMMS starts `claude plugin marketplace update omms` then `claude plugin update omms@omms` in a detached process. The hook does not wait for it.
- A marker in `~/.omms/claude-plugin-update.json` stops a second start for the same release within 30 minutes.
- `OMMS_DISABLE_UPDATE_CHECK=1` turns it off. The session-start hook never fails because of it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`: the plugin updates itself when npm has a newer release.

## Impact

- New `src/adapters/claude-code/plugin-self-update.ts`; `hook-command.ts` calls it after the session-start hook.
- `tests/preload.ts` removes `CLAUDE_PLUGIN_ROOT` so tests never update the real plugin.
- `docs/claude-code-adapter.md`.
- Claude Code only. Pi and OpenCode already update from npm.
