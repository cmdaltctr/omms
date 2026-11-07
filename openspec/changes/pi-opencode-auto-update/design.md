## Context

Claude Code already updates OMMS by itself. `src/adapters/claude-code/plugin-self-update.ts` reads the plugin version, asks npm for `latest` (`src/services/update-check.ts`), writes a marker in `~/.omms/claude-plugin-update.json`, and starts `claude plugin update` in a detached Node process. A second session skips the update for 30 minutes.

OpenCode V2 only tells the user. `src/adapters/opencode/tui-status.ts` checks npm at start and every 6 hours, adds `· <version> available` to the footer and shows one toast with the command.

Pi has no OMMS update check. The Pi adapter shows a status label (`ctx.ui.setStatus`) and can notify (`ctx.ui.notify`). Pi itself shows a generic package notice.

Both hosts install OMMS from npm into their own folders:

- Pi: `~/.pi/agent/npm/node_modules/om-memory-system/`, source `npm:om-memory-system` in `~/.pi/agent/settings.json`.
- OpenCode: `~/.cache/opencode/npm/om-memory-system@<spec>/node_modules/om-memory-system/`. The `@<spec>` part is `latest` unless the user pinned a version.

A running host keeps the loaded copy in memory. A new copy loads only after a restart. Past updates (4.27.0, 4.28.0) showed that OpenCode's background service keeps the old copy until it restarts.

## Goals / Non-Goals

**Goals:**

- Pi and OpenCode install approved releases without a typed command.
- The user sees one clear message: restart to finish.
- Same behaviour on both hosts. Shared logic outside the adapters.

**Non-Goals:**

- Restarting the host for the user. A restart would end open sessions.
- Updating a pinned version or a local checkout.
- Changing Claude Code behaviour.
- Updating the global CLI or the web app. The web app has its own Update button.

## Decisions

### 1. One shared self-update module

Add `src/services/host-self-update.ts`. It holds the decision that Claude Code has today: disabled check, npm `latest`, `availableUpdate`, 30-minute marker, detached start. Inputs come through a deps object, as in `plugin-self-update.ts`, so tests need no real npm or processes. The module does not import `CONFIG`. Each adapter passes the host name, the update command, the marker path and the running version.

Claude Code keeps its own module in this change. Moving it onto the shared module is a follow-up refactor with no behaviour change. Alternative considered: change Claude Code in the same change. Rejected to keep the change small and the Claude Code path, which works, untouched.

### 2. The detached process records the result

The detached Node script runs the host command, then writes the exit result into the same marker file: `{ version, startedAt, outcome: "installed" | "failed", finishedAt }`. The running plugin cannot hear from the detached process, so it reads the marker.

- OpenCode: the status loop reads the marker every 60 seconds while an update is pending, for at most 10 minutes. A marker read is one small file read.
- Pi: the same poll runs from the adapter, started on `session_start` and stopped on `session_shutdown`.

Alternative considered: wait for the child in the plugin process. Rejected because Claude Code's design needs the child to outlive the session, and the same holds when a user closes Pi straight after it starts.

### 3. When OMMS runs the update

OMMS runs the update only when all are true:

- `OMMS_DISABLE_UPDATE_CHECK` is not `1`.
- The running module file sits under a `node_modules/om-memory-system/` folder. A local path, such as a dev checkout, skips the update.
- The install is not pinned. OpenCode: the cache folder name ends in `@latest` or has no version. Pi: the `packages` entry in `~/.pi/agent/settings.json` is `npm:om-memory-system` with no `@<version>`. A settings file that cannot be read counts as pinned, so OMMS does nothing.

When the update is skipped for a pin or a local path, the notice keeps today's "available, run <command>" text.

### 4. Notice text

| State                 | Footer suffix              | One-time message                                       |
| --------------------- | -------------------------- | ------------------------------------------------------ |
| Newer, update skipped | `· <v> available`          | names the update command                               |
| Newer, update running | `· <v> available`          | "om-memory-system <v> is installing in the background" |
| Update installed      | `· <v> installed, restart` | "<v> installed. Restart <host> to use it."             |
| Update failed         | `· <v> available`          | names the update command                               |

Pi's suffix is added to the status label after the glyph, so `↻` and `✎` keep the suffix.

### 5. Windows

The detached script runs the command through the shell on Windows, as Claude Code's script does (`shell: process.platform === "win32"`), with a 120-second timeout.

## Risks / Trade-offs

- [`opencode plugin update` talks to the running background service, which may still hold the old copy] → The command writes the new copy to the cache. The notice tells the user to restart. Implementation task 5.3 checks this live in a scratch HOME.
- [Pi's `pi update <source>` may also move a pinned package] → Decision 3 skips pinned installs before the command runs, so the host's pin handling does not matter.
- [A user who never restarts stays on the old version] → Same as Claude Code. The footer keeps `installed, restart` until the restart.
- [Two hosts update at the same moment from one marker race] → Each host has its own marker file. Within one host, the marker is written before the spawn, as in Claude Code.
- [The npm registry is down] → The check returns null and nothing happens, as today.

## Migration Plan

No data changes. Users who want the old behaviour set `OMMS_DISABLE_UPDATE_CHECK=1`. Roll back by reverting the release.

## Open Questions

None.
