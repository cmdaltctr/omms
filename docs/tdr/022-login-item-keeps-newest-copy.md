# TDR-022: The login item keeps the newest OMMS copy

- **Date:** 2026-10-02
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** web app, login item, OpenCode, upgrade

## Context

After 4.2.0 was installed globally, the login item ran OpenCode's cached 3.6.2. The next login would have started the old web app.

### Root Cause Analysis

- **Symptom:** `~/Library/LaunchAgents/io.github.cmdaltctr.omms.web.plist` pointed at `~/.cache/opencode/npm/om-memory-system@latest/<id>/node_modules/om-memory-system`, version 3.6.2.
- **Cause:** every host start makes sure the login item exists. `installWebAutostart` wrote the path of the OMMS copy that called it. OpenCode's background server, started at 07:52, ran its cached 3.6.2 and rewrote the item over the 4.2.0 path.

## Decision

`installWebAutostart` points the item at the newest valid copy among three candidates:

1. The copy that calls it.
2. The global install beside the runtime (`<prefix>/lib/node_modules/om-memory-system`, or `<runtime dir>/node_modules/om-memory-system` on Windows).
3. The copy the item already runs, read back with `itemPackageRoot`.

A copy is valid when its `package.json` names `om-memory-system` and it has `dist/cli/index.js`. `preferredPackageRoot` compares versions with `compareVersions`. `tests/web-autostart.test.ts` covers an older caller and a newer global install.

## Consequences

### Positive

- An older host cache can no longer downgrade the login item.

### Negative

- A user who wants an older login item must uninstall the newer global copy first.

### Neutral

- An explicit `packageRoot` option, as tests use, still wins.

## Alternatives Considered

| Option                                  | Rejected Because                                                |
| --------------------------------------- | --------------------------------------------------------------- |
| Only the global install writes the item | Users without a global install would have no login item.        |
| Never rewrite an existing item          | A real upgrade through a host would never reach the login item. |
