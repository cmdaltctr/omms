# TDR-021: Load the Pi SDK from Pi's install outside Pi

- **Date:** 2026-10-01
- **Status:** Proposed
- **Deciders:** OMMS maintainers
- **Tags:** Pi, web app, login item, backfill

## Context

Every Pi backfill started by the login web app failed with `Cannot find package '@earendil-works/pi-coding-agent'`. The Settings page then showed 0 unresolved Pi sessions while Directory maps listed 28 folders, because the failed run never counted them.

### Root Cause Analysis

- **Symptom:** `backfill_state` for Pi had `state = failed` and the package error.
- **Cause:** OMMS reads Pi sessions through Pi's SDK, a peer dependency. Inside Pi, Pi supplies it. The login item runs OMMS from `~/.pi/agent/npm/node_modules/om-memory-system`, where no copy is installed. The managed Pi install keeps the SDK in `~/.pi/agent/install/releases/<version>/node_modules`, which Node does not search. launchd also gives the login item a short `PATH`.

## Decision

`src/importer/pi-sdk.ts` exports `loadPiSdk()`. It tries the normal `import()` first. When that fails, it loads the package entry from, in order:

1. `~/.pi/agent/install/releases/<current-version>/node_modules/@earendil-works/pi-coding-agent`.
2. The package behind each `pi` command on `PATH`, and `<bin>/../lib/node_modules`.
3. The global `node_modules` of the running Node.

It keeps the original error when no copy is found. `session-loader.ts`, `import-readiness.ts`, and `settings-models.ts` load the SDK through it. `tests/pi-sdk.test.ts` covers each step and the not-found case.

## Consequences

### Positive

- Pi backfill, Pi model lists, and Pi imports work from the login web app.

### Negative

- OMMS can load a newer SDK than the one it was tested against (0.86.1). The session reader uses only `SessionManager.open`, which is stable.

### Neutral

- The first successful load is cached for the process.

## Alternatives Considered

| Option                                          | Rejected Because                                       |
| ----------------------------------------------- | ------------------------------------------------------ |
| Make the SDK a direct dependency                | Duplicates Pi in every install and can clash with Pi.  |
| Tell users to `npm i -g` the SDK                | A manual step that the managed Pi install already has. |
| Set `NODE_PATH` in the login item's launchd job | Covers the login item only, and breaks on Pi upgrades. |
