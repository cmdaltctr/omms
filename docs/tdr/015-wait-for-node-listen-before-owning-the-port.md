# TDR-015: Wait for the Node listen result before the web app owns the port

**Date:** 2026-09-29
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-ui, node, port-ownership, claude-code

## Context

The web app runs under Bun inside OpenCode, and under Node for Pi, the login item, `om-memory-system web`, and the Claude Code hooks. When another program held the configured port, a web app started under Node stayed alive but did not listen on any port. It also did not take the port over after the other program stopped.

The Claude Code hooks start the web app on demand when `/api/health` fails. Each hook that ran while a program other than OMMS held the port started one more stuck process. Two hooks that started the web app at the same time had the same result.

### Root Cause Analysis

`serveFetch` in `src/services/web-server.ts` called `server.listen()` and then checked for an `EADDRINUSE` error at once. Node reports that error through the `error` event after `listen()` returns, so the check always passed. `_start()` then set `isOwner = true` and did not start the health-check loop. The `error` handler recorded the late error and did nothing with it.

Bun's `Bun.serve` throws the error at once, so OpenCode was not affected.

## Decision

`serveFetch` is now `async`. On Node it waits for the `listening` callback or the first `error` event, and rejects on the error. `_start()` awaits it. The existing `EADDRINUSE` branch then marks the process as a non-owner and starts the health-check loop, as it does under Bun. After a successful listen, a no-op `error` listener keeps later socket errors from stopping the process.

## Consequences

### Positive

- A web app started under Node while the port is busy becomes a non-owner and takes the port over when it is free.
- Repeated or racing Claude Code hooks no longer leave stuck processes.

### Negative

- Start-up now waits for the bind, which adds a few milliseconds.

### Neutral

- Bun behaviour does not change.

## Alternatives Considered

| Option                                              | Rejected Because                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Make the hook check for a listener before it spawns | It does not fix Pi, the login item, or `om-memory-system web`.      |
| Exit the web app when the port is busy              | It breaks the existing takeover rules that OpenCode and Pi rely on. |

## How to Recognise / Handle This Again

1. Symptom: a `node … dist/cli/index.js web` process runs, but `lsof -a -p <pid> -iTCP -sTCP:LISTEN` shows no listener.
2. Check that the port was held by another program when the process started.
3. Make sure every `listen()` result is awaited before the code sets `isOwner`.

## Revisit Triggers

- A change to `serveFetch`, `_start()`, or the takeover loop.
- A move of the web server to another HTTP library.

## References

- `src/services/web-server.ts` (`serveFetch`, `_start`, `attemptTakeover`)
- `tests/web-node-port-in-use.test.ts`
- [ADR-013](../adr/013-claude-code-host-through-hooks-and-web-app.md)
