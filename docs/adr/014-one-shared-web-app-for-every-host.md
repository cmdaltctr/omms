# ADR-014: One shared web app for every host

**Date:** 2026-09-29
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

The OMMS web app could run in four ways:

- OpenCode ran a web server inside its plugin process.
- The login item ran `om-memory-system web --login-item` at login. It is on by default.
- A Claude Code hook started a detached `om-memory-system web` when no web app answered.
- A user ran `om-memory-system web` in a terminal.

Pi started no web app. It only installed the login item.

These copies competed for one port. The web server needed takeover and fallback-port rules, and `web install` needed a step-aside route (`web-version-handover`). The OpenCode in-process server could use OpenCode's signed-in models for page imports, model tests, and **Retry now**. In the default setup the login item already held the port before OpenCode started, so most users did not get those features.

The user asked for a power button to stop and restart the web app, and for every host to start the web app when it is off, without two copies on one machine and without logic in each adapter.

## Decision

One standalone web app serves every host.

- A shared module, `src/services/web-ensure.ts`, exports `ensureWebApp()`. It probes the configured port. It uses an OMMS web app that answers, and starts one detached `om-memory-system web` when none answers.
- A start lock file (`~/.omms/web-start.lock`, exclusive create) makes sure concurrent callers start one web app. A lock is stale when its pid is dead or it is older than 20 seconds.
- The module never starts a web app on another port. When a program that is not OMMS holds the port, it starts nothing and logs a code.
- OpenCode, Pi, and the Claude Code hook each call it with one line. OpenCode no longer runs a web server inside its session.
- The page can stop and restart the web app, because only one kind of web app exists.

## Consequences

### Positive

- One place decides whether to start the web app. Adapters stay thin.
- Pi users get the web app at session start, as OpenCode and Claude Code users do.
- Concurrent host starts cannot create two web apps.
- A stopped web app comes back at the next host start.
- The power button has one behaviour.

### Negative

- The web page can no longer use OpenCode's signed-in models. Page imports with an OpenCode model, the OpenCode model test, a page-started OpenCode backfill with an OpenCode model, and **Retry now** for OpenCode's queued turns report that they are unavailable and name the next step.
- The spawned web app runs the version of the package that started it. It can differ from the global command until `web install` hands the port over.

### Neutral

- Live capture, profile learning, automatic backfill, terminal imports, and `/import` in OpenCode still run in the host process with the host's model.
- The step-aside no-callback path stays for OpenCode sessions with an older plugin.
- To keep the web app off, the user sets `webServerEnabled` to `false`.

## Alternatives considered

- **Keep OpenCode's in-process server and add the start check to Pi and Claude Code.** This keeps OpenCode's page features for users with the login item off. It keeps two kinds of web app, two power-button modes, and the in-process code paths.
- **Add a standalone OpenCode import reader first.** It would keep page imports with OpenCode's models. It is a larger change. It stays a follow-up, like the existing standalone model-list reader.
- **Use a port bind as the lock.** The spawned child binds the port, not the caller, so a bind check races with the child's own start.

## References

- OpenSpec change `web-power-button`
- OpenSpec change `web-version-handover` (PR #50)
- ADR-009: Default-on history backfill and login web app
- ADR-011: Shared code never imports a host adapter
- ADR-013: Claude Code host through hooks and the web app
