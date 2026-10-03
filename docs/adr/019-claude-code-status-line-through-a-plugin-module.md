# ADR-019: Claude Code shows OMMS status through a plugin module

**Date:** 2026-10-02
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

OpenCode and Pi show OMMS state and a newer-release notice ([ADR-017](./017-opencode-status-and-update-notice.md)). Claude Code showed nothing. A Claude Code user could not see that the web app was off, or that the OMMS copy behind the hooks was older than the npm release.

- Claude Code 2.1.287 added plugin modules. A module is plain JavaScript that can draw a status line and a toast. It has no Node.js APIs. It reaches the outside only through `$.http.fetch`, `$.process.run`, `$.clock.every`, `$.ui.status`, and `$.ui.toast`.
- The hooks already run the plugin launcher, `bin/omms-launch.mjs` ([ADR-018](./018-newest-copy-runtime.md)). A global install is optional, so a bare `om-memory-system` on `PATH` is not a safe way to ask OMMS anything.
- Claude Code allows one `statusLine` setting, and the user may already own it.
- The host parity rule asks for the same user capabilities on every host.

## Decision

1. Add one module, `hooks/omms-status.js`, to the existing `omms` plugin. It is listed under `modules` in `hooks/hooks.json`. The command hooks stay unchanged. The plugin needs Claude Code 2.1.287 or later. There is no second plugin for older versions.
2. The module draws with `$.ui.status`, which is a separate line. It never touches the user's `statusLine`.
3. The module gets its facts through the plugin launcher: `claude-hook status` prints `{ healthUrl, version, latest }`. The launcher picks the same copy as the hooks, so the line and the hooks always agree. The module holds no OMMS logic except a small version comparison.
4. At start and every 6 hours the module runs that command with a 60-second limit. Every 30 seconds it fetches the health URL.
5. States are `connected` (a 401 counts), `web app off`, and `not installed`. `not installed` means the launcher exited non-zero, or Node.js could not start. A timeout never shows `not installed`. It keeps the health-only line and tries again at the next step.
6. When npm `latest` is a stable release newer than `version`, the line adds `· <version> available`, and one toast per version names `claude plugin update omms@omms`. `OMMS_DISABLE_UPDATE_CHECK=1` turns the check off.
7. `latestNpmVersion` and `availableUpdate` move from the OpenCode adapter to `src/services/update-check.ts`, so no adapter imports another host's adapter.

## Consequences

### Positive

- Claude Code users see whether OMMS works and learn about new releases, as OpenCode and Pi users do.
- One launcher decides which OMMS runs. The status line cannot disagree with the hooks.
- The npm lookup and the version rule exist in one place for two hosts.

### Negative

- Claude Code 2.1.286 and older are not supported.
- The module runs only where hooks run. It is absent in an untrusted workspace, with `--bare` or `--safe-mode`, and with `disableAllHooks`.
- Every 6 hours a Node.js process starts, and one public request goes to npm.
- An OMMS copy from before `status` logs one `bad-event` line per check.

### Neutral

- `claude plugin test` has no file filter, so the module test runs through `scripts/test-claude-mod.sh` ([TDR-025](../tdr/025-claude-plugin-test-runs-whole-folder.md)).

## Alternatives Considered

| Option                                    | Rejected Because                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Run bare `om-memory-system` from `PATH`   | A global install is optional and can be older than the copy the hooks run. |
| Hard-code `http://127.0.0.1:4747`         | `webServerPort` and `webServerHost` are configurable.                      |
| The module fetches npm itself             | The version rule would live in two places.                                 |
| Wrap or replace the user's `statusLine`   | Overwrites a setting the user owns. Claude Code allows only one.           |
| A second plugin for older Claude Code     | More to ship and test for a version range we choose not to support.        |
| Start Node.js every 30 seconds for health | Costs far more than one local HTTP request.                                |

## References

- OpenSpec change: `openspec/changes/archive/2026-10-03-claude-code-status-line/`
- `hooks/omms-status.js`, `src/adapters/claude-code/status.ts`, `src/services/update-check.ts`
- [Claude Code adapter: Status line](../claude-code-adapter.md#status-line)
- [ADR-017](./017-opencode-status-and-update-notice.md), [ADR-018](./018-newest-copy-runtime.md)
