# Design

## Context

- The Claude Code plugin is `.claude-plugin/plugin.json` plus `hooks/hooks.json`. It has three command hooks. Each one runs `node "${CLAUDE_PLUGIN_ROOT}/bin/omms-launch.mjs" --at-least-own-version claude-hook <event>` (from `newest-copy-runtime`, #79). The launcher runs the newest local OMMS copy at or above the plugin's version, or `npx --yes om-memory-system@<plugin version>`. When it finds nothing it exits 1. The global install is optional.
- `runCli` hands off to the newest recorded copy, so any OMMS command run through the launcher reports the version that runs.
- release-please keeps `.claude-plugin/plugin.json` at the package version. A plugin update raises the launcher's minimum version, so it pulls in the matching OMMS code.
- The OpenCode footer (`src/adapters/opencode/tui-status.ts`) checks the web app's `/api/health` every 30 seconds and npm `latest` at start and every 6 hours. It reports a newer stable release with `availableUpdate`.
- Mods (Claude Code 2.1.287+) are listed under `modules` in `hooks/hooks.json`. A hooks module has no Node.js APIs. It reaches the outside only through `$.http.fetch`, `$.process.run`, `$.clock.every`, `$.ui.status` and `$.ui.toast`. `$.plugin.root` gives the plugin's folder. A hook's own run time is limited to 10 seconds. `$.process.run` has a 30-second default timeout and a 10-minute maximum.
- `/api/health` needs no API token. When browser password auth is on, it can answer 401.
- The user's machine already has a `statusLine` command (Orca). Claude Code allows one `statusLine`. `$.ui.status` draws a separate line and leaves it alone.

## Goals / Non-Goals

**Goals:**

- The same states and timing as the OpenCode footer.
- The hooks module stays small, with no OMMS logic copied into it.
- The status line uses the same launcher as the command hooks, so both always agree on which OMMS runs.
- One plugin, `omms`. Claude Code 2.1.287 or later is required.

**Non-Goals:**

- Changing or wrapping the user's `statusLine`.
- Updating anything automatically.
- A pane, a command, or a tool. Only the status line and a toast.
- Telling the user about the global install. It is optional, and the Settings page already reports it.
- Support for Claude Code older than 2.1.287, or a second plugin for it.

## Decisions

### 1. The mod gets facts through the plugin's launcher, then polls health itself

At session start and every 6 hours, the mod runs `$.process.run(["node", <$.plugin.root>/bin/omms-launch.mjs, "--at-least-own-version", "claude-hook", "status"], { timeoutMs: 60_000 })`. The command prints one JSON line: `{ "healthUrl", "version", "latest" }`. `version` is the version of the copy that runs. `latest` is `null` when the check is off or fails. Every 30 seconds the mod fetches `healthUrl` with `$.http.fetch`.

- The launcher picks the same copy the command hooks use, so the line and the hooks always agree.
- The copy that runs already knows the configured host, port and version, and owns the npm logic. The mod copies none of it.
- The timeout is 60 seconds because a first `npx` download can take longer than the 30-second default. The call runs on the timer, so it never blocks the session.
- Starting Node every 30 seconds would cost far more than one local HTTP request. So only the 6-hour step runs the command.
- Alternative: run the bare `om-memory-system` from `PATH`. Rejected: the global install is optional and can be older than the copy the hooks run.
- Alternative: hard-code `http://127.0.0.1:4747` in the mod. Rejected because `webServerPort` and `webServerHost` are configurable.
- Alternative: let the mod fetch npm itself. Rejected because the version comparison would then live in two places.

### 2. Health states

A health response with `success: true` means `connected`. A 401 also means `connected`, because a server that refuses the password is still running. Any other result, or no answer within 3 seconds, means `web app off`. When the launcher exits with a non-zero code, or `$.process.run` rejects because Node.js cannot start, the state is `not installed` and there is no update check.

### 3. Shared update logic moves to `src/services/`

`latestNpmVersion` and `availableUpdate` move from `src/adapters/opencode/tui-status.ts` to a new `src/services/update-check.ts`. `tui-status.ts` imports them from there. This keeps the rule that an adapter must not import another host's adapter. The status JSON builder is a new pure module in `src/adapters/claude-code/`, with `CONFIG` passed in, because tests stub `src/config.js`.

### 4. The status text matches OpenCode

Claude Code prefixes the plugin name, so the mod sets `connected`, `web app off`, or `not installed`, plus ` · <version> available`. The line reads `omms: connected · 4.4.0 available`. A toast shows once per session per version: `OMMS <version> is available. Run: claude plugin update omms@omms, then /reload-plugins`. The toast names the plugin update because that raises the launcher's minimum version. Marketplace auto-update does the same step on its own.

### 5. One `hooks.json` holds both

`hooks/hooks.json` gains `"modules": ["./omms-status.js"]` beside the existing `hooks` key. The launcher commands under `hooks` stay unchanged. The module is plain JavaScript, so Claude Code needs no build step.

## Risks / Trade-offs

- [Claude Code older than 2.1.287 may not load the plugin] → Not supported. The docs and the plugin description state the minimum version.
- [A mod runs only in a trusted workspace, and not with `--bare`, `--safe-mode`, or `disableAllHooks`] → The command hooks follow the same rules, so the status line is simply absent where hooks are off. Document it.
- [The `⚠` prefix Claude Code adds can look like a warning] → Claude Code controls it, so we accept it. The docs say what the line means.
- [The copy that runs predates the `status` subcommand] → An unknown subcommand exits 0 with no JSON. The mod then shows `connected` or `web app off` from the default health URL `http://127.0.0.1:4747/api/health`, with no update check. The launcher's minimum version makes this rare: it only happens when a newer recorded copy is still older than this release.
- [A first `npx` run is slow] → Until the status JSON arrives, the mod polls the default health URL. The version and update notice show once the command answers.
- [`$.process.run` cold start takes 1 to 2 seconds] → It runs outside the 10-second hook limit, on the timer, and does not delay session start.

## Migration Plan

No data migration. Users get the mod with the next plugin update (marketplace auto-update or `claude plugin update omms@omms`). Rollback: remove `modules` from `hooks/hooks.json`.
