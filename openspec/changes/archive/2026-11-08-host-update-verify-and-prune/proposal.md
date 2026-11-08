## Why

The live check of `pi-opencode-auto-update` found two gaps:

- The background update records `installed` when the host command exits with 0. A command that exits with 0 but installs nothing still makes the footer say `installed, restart`. A restart then loads the old copy again, and the user sees the same message with no way out.
- Each OpenCode update adds a new copy of OMMS, about 900 MB, under `~/.cache/opencode/npm/om-memory-system@latest/<timestamp>/`. OpenCode never removes the old copies, so the disk fills up with each release.

## What Changes

- Before OMMS reports `installed`, it reads the installed copy and confirms that it holds the new version. When it does not, OMMS reports the update as failed: the footer keeps `· <version> available` and the message names the update command. This applies to Pi and OpenCode.
- When the OpenCode background service starts OMMS from a timestamped cache folder, OMMS removes older OMMS copies in the same cache folder. It keeps the copy that runs, every newer copy, the copy that `~/.omms/runtime.json` records, and every copy installed less than 24 hours before the running copy. A copy that cannot be removed stays. Each pass logs one record with counts only.
- Docs say that OMMS removes old OpenCode copies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-v2-adapter`: the restart notice requires a confirmed install; new requirement for removing old cache copies.
- `pi-agent-adapter`: the restart notice requires a confirmed install.

## Impact

- `src/services/host-self-update.ts`: confirm the installed version before `installed`.
- New `src/services/host-copies.ts`: list the installed copies and remove old OpenCode copies.
- `src/adapters/pi/self-update.ts`, `src/adapters/opencode/tui-status.ts`: use the confirmed status.
- `src/v2/plugin.ts`: start the clean-up in the background service, without waiting for it.
- Tests for each part. `docs/upgrading.md`, `docs/opencode-adapter.md`, `UPDATES.md`, one ADR and one TDR.
- No new dependencies. No network calls.
