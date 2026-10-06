# TDR-036: Restart waits for its own copy

- **Date:** 2026-10-06
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Tags:** web app, restart, port ownership

## Context

A user pressed Restart on a 4.9.0 web app. Afterwards the page still served 4.8.0, and the new 4.9.0 copy waited behind it for hours.

### Root Cause Analysis

The log showed this order on 2026-10-06:

1. 16:10:46: the 4.9.0 web app started a detached copy and stopped serving.
2. 16:10:50: a 4.8.0 login item, which waited for the port, took it first.
3. The 4.9.0 web app probed `/api/health`, got an answer from 4.8.0, and exited.

The restart check accepted any OMMS web app on the port as its copy. An older standalone waiter also never left while a newer web app owned the port.

## Decision

- `createPowerAction` gives the copy an instance ID through `OMMS_WEB_INSTANCE`. The web server reports it as `instance` on `/api/health` and `/api/web/status`, and removes the variable from its environment.
- The handoff exits only when `/api/health` reports that ID. Health skips basic auth, so this works with `webServerAuth` on. The version comes from `/api/web/status`.
- It asks each older owner to step aside once, by instance, and then gives the copy a new 15 seconds. For a same or newer owner, or one whose version it cannot read, it stops the copy, logs `other-owner`, and exits.
- It reads its own version from disk at restart time, so an in-place upgrade compares as the new version.
- A standalone waiter reads the owner version on each 5-second check. When the owner is newer, it runs its step-aside callback and exits with code `0`.

## Consequences

A restart ends with its own copy or a web app of the same or a newer version on the port. Old standalone waiters leave on their own. Waiters from 4.9.0 and earlier do not have the retire rule, so the step-aside request covers them. A standalone waiter sends one more local request every 5 seconds.

## Alternatives Considered

| Option                                        | Rejected Because                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kill every OMMS process on restart            | Needs a process registry. A web app inside OpenCode would take the session down.                                                                                               |
| Read the instance only from `/api/web/status` | Basic auth blocks it for a token-only caller, so every restart would fail with `webServerAuth` on. The instance is opaque, so health carries it; the version stays off health. |
| Keep the health probe, add a version          | A same-version waiter would still pass as the copy.                                                                                                                            |

## How to Recognise / Handle This Again

1. Settings shows an older **Running version** after a restart.
2. Search `~/.omms/omms.log` for `Web server takeover successful` right after `Web server power request`.
3. Stop the older process. Run `om-memory-system web` or start a host.

## References

- `src/cli/web-power.ts`
- `src/services/web-server.ts`
- `tests/web-power-action.test.ts`
- `tests/web-standalone-retire.test.ts`
