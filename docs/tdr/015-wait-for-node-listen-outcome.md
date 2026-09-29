# TDR-015: Wait for the Node listen outcome before claiming the web port

**Date:** 2026-09-29
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-server, node, login-item

## Context

The login item and `om-memory-system web` run the web app under Node. When another web app held port 4747, the new one never took the port over, even after the old one stopped. After an upgrade to 3.5.0, the 3.4.2 web app kept serving the port. When it was stopped, the port stayed free until the login item was restarted.

### Root Cause Analysis

`serveFetch` called `server.listen()` and then checked a variable set by the `error` handler. Node emits `EADDRINUSE` on a later tick, so the check always passed. `WebServer._start()` set `isOwner = true` on a server that was not listening, and it never started the health loop that runs the takeover. Bun's `Bun.serve()` throws at once, so OpenCode sessions under Bun were not affected.

## Decision

`serveFetch` returns a promise. On Node it resolves on `listening` and rejects on `error`. `_start()` awaits it, so `EADDRINUSE` reaches the existing branch that starts the health loop. After the server listens, a listener logs later server errors, so they do not crash the process.

## Consequences

### Positive

- A Node web app that meets a busy port waits as a non-owner and takes the port when the owner stops.
- Other listen errors, such as `EACCES`, are now logged and thrown instead of ignored.

### Negative

- None known.

### Neutral

- The Bun path is unchanged.

## Alternatives Considered

| Option                           | Rejected Because                                               |
| -------------------------------- | -------------------------------------------------------------- |
| Probe the port before `listen()` | A race: another process can bind between the probe and listen. |
| Check ownership after a delay    | A fixed delay is a guess, and it slows every start.            |

## How to Recognise / Handle This Again

1. `launchctl print gui/$(id -u)/io.github.cmdaltctr.omms.web` shows the item running, but `lsof -iTCP:4747 -sTCP:LISTEN` shows another process or none.
2. Check that the running build includes this fix.
3. Restart the item with `launchctl kickstart -k gui/$(id -u)/io.github.cmdaltctr.omms.web`.

## Revisit Triggers

- A change to `serveFetch` or to the Node or Bun server APIs.

## References

- `src/services/web-server.ts` (`serveFetch`, `_start`)
- `tests/web-standalone-takeover.test.ts`
