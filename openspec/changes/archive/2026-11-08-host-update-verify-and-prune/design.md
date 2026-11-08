## Context

`pi-opencode-auto-update` runs the host update command in a detached process and writes `outcome` to a marker. The plugin reads the marker and shows `installed, restart`. The outcome comes from the exit code alone.

Pi updates its copy in place: `~/.pi/agent/npm/node_modules/om-memory-system/`. OpenCode 2.2 writes each update to a new folder: `~/.cache/opencode/npm/om-memory-system@latest/<timestamp>/node_modules/om-memory-system/`. The timestamp is milliseconds since 1970. OpenCode loads the newest folder at the next start and never removes old ones.

The OpenCode background service runs the server plugin (`src/v2/plugin.ts`). It can run for days. The TUI loads its own modules when it starts. The web app and the terminal command run the copy that `~/.omms/runtime.json` records, which can be an OpenCode cache copy.

## Goals / Non-Goals

**Goals:**

- `installed` means the new version is on disk.
- Old OpenCode copies do not fill the disk.
- No running process loses files it still needs.

**Non-Goals:**

- Removing copies that OpenCode or Pi install for other plugins.
- Removing Pi copies. Pi updates in place.
- Removing copies on a schedule. The clean-up runs when the service starts.

## Decisions

### 1. Confirm in the plugin, not in the detached script

The plugin reads the copies on disk when it reads the marker. When the marker says `installed` and no copy holds the new version, the plugin treats the status as `failed`. The detached script stays as it is.

Alternative considered: check in the detached script. Rejected: the script is a string, so the check would have no unit tests, and the host paths would be duplicated.

### 2. One helper lists the copies

`src/services/host-copies.ts` finds the package root of the running copy (the folder under `node_modules/om-memory-system/`). When the folder above `node_modules` is a timestamp folder, it also lists every sibling timestamp folder with the version in its `package.json`. Both the install check and the clean-up use this list.

### 3. Clean-up rules

The clean-up runs once in the OpenCode background service, after start, without waiting. It removes a sibling timestamp folder only when all are true:

- Its timestamp is older than the timestamp of the running folder.
- Its version is older than the running version.
- It is not the copy that `~/.omms/runtime.json` records.
- The running folder was installed at least 24 hours before now. A TUI or web app that started before the update has had a day to restart.

A folder that cannot be removed (for example a locked file on Windows) stays. The pass logs one `OpenCode cache clean-up` record with the number removed and kept. It never throws.

Alternative considered: clean up from the TUI. Rejected: a TUI can start on the new copy while the service still runs the old copy and loads modules from it later.

### 4. Fixed values

24 hours is fixed by this design. It is a constant in `host-copies.ts`.

## Risks / Trade-offs

- [A TUI or web app runs an old copy for more than 24 hours after the update] → It can fail to load a module until it restarts. The web app records its copy in `runtime.json`, which the clean-up keeps.
- [OpenCode changes its cache layout again] → The clean-up finds no timestamp folder and does nothing. The install check reads the running copy only.
- [A copy without a readable `package.json`] → It has no version, so it stays.

## Migration Plan

No data changes. The first service start after the release removes old copies that match the rules.

## Open Questions

None.
