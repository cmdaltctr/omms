# TDR-064: Host icons lived in the active space folder

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memory-spaces, host-appearance, storage, web

## Context

The Memory page lets the user change the icon of each host card (Pi, OpenCode, Claude Code). The server saved the choice in `<storagePath>/host-appearance/`. Before memory spaces, `storagePath` never changed while the app ran, so this was one global folder in practice.

### Root Cause Analysis

A memory space switch changes `CONFIG.storagePath` to the folder of the new space. The host icon routes read the folder from `CONFIG.storagePath` on every request. After a switch, the routes looked in the new space's folder, found nothing and returned the default marks. An icon set while a space was active stayed in that space.

Found while building the space icons: a route test switched the space and read the host icon again. The first version of the test passed on the old code, because the test scenario had not loaded the config, so the switch never took effect. After the scenario loaded the config, the test failed as expected.

## Decision

Host icons live in the global storage folder, the same rule as `skills.db` and the embedding model cache (ADR-041):

```ts
const globalFolder = (config) => config.skillStoragePath ?? config.storagePath;
```

`routeMemoryHosts` uses it for every host appearance request. The icons of the spaces are in `~/.omms/space-appearance/`, outside every space folder, for the same reason.

## Consequences

### Positive

- A space switch never hides a host icon, and an icon set in one space shows in all of them.

### Negative

- A host icon saved in a non-default space before this fix stays in that space's `host-appearance` folder and is not shown. Memory spaces were not released before the fix, so no user is affected.

### Neutral

- `createHostAppearance` is now a thin wrapper over a generic `createAppearance(directory, accepts, message)`, which the space icons also use.

## Alternatives Considered

| Option                               | Rejected Because                                  |
| ------------------------------------ | ------------------------------------------------- |
| Copy host icons into every new space | Two copies drift apart, and a delete loses a copy |
| Keep icons per space on purpose      | The host icons describe the hosts, not the memory |

## How to Recognise / Handle This Again

1. Symptom: a setting that is about the person or the app, not about the memories, resets after a space switch.
2. Check where its route reads the folder. `CONFIG.storagePath` is the folder of the active space.
3. Use `CONFIG.skillStoragePath ?? CONFIG.storagePath` for anything that is global. A route test must switch the space between two reads, and must load the config first.

## Revisit Triggers

- A new setting stored under `storagePath`.
