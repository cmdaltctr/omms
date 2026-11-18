# TDR-088: A running web app reported the version on disk

**Date:** 2026-11-18
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-app, runtime-record, npm, update

## Context

On 18 November 2026 most cards on the Settings page showed `SyntaxError: The requested module '../config.js' does not provide an export named 'getLastGoodGlobalFileConfig'`. The Memorisation page showed "The settings could not be loaded."

The web app on port 4747 had started on 16 November. Version 7.0.1 was installed globally on 18 November, into the same folder. The old process kept running. Nothing replaced it.

### Root Cause Analysis

- `packageVersion()` (`src/services/package-version.ts`) read `package.json` from disk at each call.
- `npm i -g` replaces the files of a running copy in place. After the update, the old process reported the new version.
- A newer copy replaces the web app only when the web app reports an older version (`ensureWebApp` in `src/services/web-ensure.ts`, `/api/web/step-aside` in `src/services/web-server.ts`). The two versions matched, so nothing replaced it.
- The old process held the old `config.js` in memory. Each settings route loads its module with `import()` on first use, so it loaded the new 7.0.1 file from disk. That file imports `getLastGoodGlobalFileConfig`, which the old `config.js` does not export.
- The same read made the `mismatch` field of `/api/settings/version` always false, so the Settings page never told the user to restart.
- A second, harmless effect: `registerCopy` (`src/services/runtime-record.ts`) kept `~/.omms/runtime.json` when the recorded folder had the same version. After an in-place update, its `version` field stayed at the first version recorded (5.10.1). Nothing reads that field: every reader takes `root` and reads the version from that folder.

## Decision

1. `packageVersion()` keeps the first version it reads for the life of the process.
2. `startWebServer` calls `packageVersion()` before it starts, so the web app keeps the version of the code it loaded.
3. `registerCopy` rewrites `runtime.json` when the recorded folder is the own copy and its stored version differs from the version on disk.
4. `tests/package-version.test.ts` and `tests/runtime-record.test.ts` cover both cases.

## Consequences

### Positive

- After an in-place global update, the next host start or Claude Code session start sees an older web app and replaces it.
- The Settings page shows the version mismatch while an old web app still runs.
- `runtime.json` shows the version that is installed.

### Negative

- A long-lived process that first calls `packageVersion()` after an update still reports the new version. The web server avoids this with the call at start.

### Neutral

- A web app that started before this fix keeps the old behaviour until it restarts once.

## Alternatives Considered

| Option                                         | Rejected Because                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Restart the web app from the npm update itself | An update from a terminal `npm i -g` runs no OMMS code           |
| Remove the `version` field from `runtime.json` | It changes the record format and the launcher tests for no gain  |
| Compare file times instead of versions         | A reinstall of the same version would then replace the app again |

## How to Recognise / Handle This Again

1. Symptom: many Settings cards show `SyntaxError ... does not provide an export named ...`, or a page says its settings could not be loaded.
2. Compare the web app's start time (`ps -o lstart -p <pid>`) with the time the global `package.json` was written.
3. Restart the web app: `launchctl kickstart -k gui/$(id -u)/io.github.cmdaltctr.omms.web` on macOS, or the power button in the web app.

## Revisit Triggers

- The web app starts loading route modules eagerly instead of with `import()`.
- OMMS changes how a newer copy finds and replaces a running web app.
