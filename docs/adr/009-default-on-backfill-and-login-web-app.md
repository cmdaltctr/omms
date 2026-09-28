# ADR-009: Default-on history backfill and login web app

**Date:** 2026-09-27
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

Live capture starts when an agent is open. Existing history import needs a manual command. OpenCode currently owns the web server, so the memory page disappears when OpenCode closes. Pi and OpenCode share the same store but have separate model sign-ins and history formats.

## Decision

Enable automatic, per-host backfill by default after a short startup delay. Each host reads only its own history and uses its own model selection. One shared runner reuses the existing importer, ledger and profile pipeline. The first run saves a per-host cutoff in the store. One database claim per host allows one backfill worker across processes. Each claim update is brief, so other sessions keep using the store. Live-captured user IDs and the cutoff prevent duplicate or racing work. Users can disable backfill globally or choose separate backfill models without changing live capture.

Enable a per-user login item for the standalone web app by default. The item starts only when the web server is enabled. Host startup reconciles its runtime and package paths after upgrades. OMMS only creates and removes its own item. OpenCode uses the running web app when it starts; Pi never hosts the page. The standalone process does not backfill because it cannot use a host's model sign-in.

## Consequences

### Positive

- Old conversations can enter the shared store without a manual command.
- The memory page stays available after both agents close.
- Manual import and the automatic runner share an idempotent ledger.

### Negative

- The first enabled host start can make many model calls and incur cost. Users can opt out or select a cheaper model before starting.
- Login-item support depends on a discoverable Node or Bun runtime and platform-specific user services.

### Neutral

- Unresolved session directories remain for manual imports with explicit maps.
- Disabling the feature preserves the cutoff and ledger for later resumption.

## Alternatives Considered

| Option                               | Rejected Because                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- |
| Keep imports manual                  | Older history stays outside the store until a user runs an import.          |
| Run both imports in the web app      | It cannot use Pi or OpenCode's signed-in host models.                       |
| Start a server only inside each host | The page disappears when the host closes.                                   |
| Run a persistent background daemon   | It needs its own lifecycle and cannot survive login without a user service. |

## References

- [Change design](../../openspec/changes/archive/2026-09-28-auto-backfill-and-web-autostart/design.md)
- [Configuration](../configuration.md#automatic-history-import-and-login-web-app)
- `src/importer/auto-backfill.ts`
- `src/services/web-autostart.ts`
