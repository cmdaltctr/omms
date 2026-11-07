## Why

Claude Code users get each approved OMMS release without any action: the session-start hook compares the plugin with npm `latest` and runs `claude plugin update` in the background. Pi and OpenCode users must notice the release and type an update command themselves. Users who are not technical forget, and stay on old versions with old bugs.

## What Changes

- When a Pi or OpenCode V2 session starts, OMMS compares its running version with npm `latest`. When npm has a newer release that is not a prerelease, OMMS runs the host's own update command in a detached process:
  - Pi: `pi update npm:om-memory-system`
  - OpenCode: `opencode plugin update om-memory-system`
- A second session does not start another update for the same release within 30 minutes. This matches Claude Code.
- `OMMS_DISABLE_UPDATE_CHECK=1` turns off the check and the update, as it does today.
- OMMS runs the update only when the host installed it from npm. A local checkout or a pinned version is left alone.
- After the update succeeds, the host notice changes from "<version> available, run <command>" to "<version> installed, restart to finish". If the update fails, the notice falls back to today's text with the command.
- Pi gets an OMMS update notice in its footer and one notification. Today Pi shows only its own generic package notice.
- OpenCode's footer shows `· <version> installed, restart` after a successful update, in place of `· <version> available`.
- Docs (`docs/upgrading.md`, `UPDATES.md`) say that Pi and OpenCode now update by themselves and only need a restart.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-v2-adapter`: the newer-release requirement changes from "tell the user" to "install in the background, then tell the user to restart".
- `pi-agent-adapter`: new requirement for the background update and restart notice in Pi.

## Impact

- New shared module in `src/services/` for the update decision (npm check, de-dup marker, detached run, result marker). Claude Code's `plugin-self-update.ts` keeps its behaviour.
- `src/adapters/opencode/tui-status.ts`: start the update, read the result, change footer and toast text.
- `src/adapters/pi/extension.ts`: call the shared module on `session_start`, show footer text and one notification.
- New marker files `~/.omms/pi-plugin-update.json` and `~/.omms/opencode-plugin-update.json`.
- Tests for both hosts and the shared module. Docs listed above.
- No new dependencies. No session content leaves the machine: the only network call is the existing npm registry read.
