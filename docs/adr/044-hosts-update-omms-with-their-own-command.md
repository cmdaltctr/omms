# ADR-044: Pi and OpenCode update OMMS by running the host's own update command

- **Date:** 2026-11-07
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`pi-opencode-auto-update`](../../openspec/changes/archive/2026-11-07-pi-opencode-auto-update/proposal.md), [`host-update-verify-and-prune`](../../openspec/changes/archive/2026-11-08-host-update-verify-and-prune/proposal.md)

## Context

Claude Code installed new OMMS releases without a typed command. Pi and OpenCode only told the user that a release existed. The user had to run `pi update npm:om-memory-system` or `opencode plugin update om-memory-system` and restart the host.

Neither host has a setting for plugin auto-update. Both hosts install OMMS from npm `latest` into their own folders. A running host keeps the loaded copy in memory, so a restart is always needed.

## Decision

1. **OMMS runs the host's own update command.** At session start, Pi and OpenCode V2 compare the OMMS version with npm `latest`. When npm has a newer release that is not a prerelease, OMMS runs `pi update npm:om-memory-system` or `opencode plugin update om-memory-system` in a detached process. OpenCode checks again every 6 hours.
2. **A marker file per host prevents repeat updates and records the result.** The files are `~/.omms/pi-plugin-update.json` and `~/.omms/opencode-plugin-update.json`. A second session does not start another update for the same release within 30 minutes. The detached script writes `outcome` to the marker. The plugin reads the marker every 60 seconds for up to 10 minutes.
3. **OMMS skips pinned and local installs.** The notice then shows `· <version> available` and the command. `OMMS_DISABLE_UPDATE_CHECK=1` turns the check and the update off.
4. **OMMS never restarts the host.** A restart would end open sessions. The footer shows `· <version> installed, restart`. For OpenCode, the message also names `opencode service restart`, because the background service keeps the old copy loaded.
5. **OMMS shows `installed, restart` only after the new version is on disk.** An exit code of 0 is not enough. When no installed copy holds the new version, OMMS shows `· <version> available` and the command.
6. **OMMS removes old OpenCode copies that it owns.** OpenCode 2.2 stores each update in a new `om-memory-system@latest/<timestamp>/` folder, about 900 MB each, and never removes old folders. When the OpenCode background service starts, OMMS removes older OMMS folders in that cache. It keeps the running folder, newer folders, the folder in `~/.omms/runtime.json`, and folders without a readable version. It removes nothing while the running folder is less than 24 hours old.
7. **Shared code lives in `src/services/host-self-update.ts`.** Claude Code keeps its own module, `src/adapters/claude-code/plugin-self-update.ts`.

## Alternatives Considered

| Option                                              | Rejected Because                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A launchd job that runs both update commands hourly | Works on macOS only, sits outside OMMS, and each user must set it up                            |
| Notice only (the earlier behaviour)                 | The user must remember to run the command                                                       |
| OMMS restarts the host after the update             | A restart ends open sessions and can lose work in progress                                      |
| Move Claude Code onto the shared module now         | Claude Code works today. The move is a refactor with no new behaviour. It stays a later change. |

## Consequences

Positive:

- Pi and OpenCode users get a new release without a typed command.
- The footer tells the user when a restart is the only step left.
- The disk does not fill with old OpenCode copies.

Negative:

- The user must still restart the host. OpenCode also needs `opencode service restart`.
- OMMS writes two marker files under `~/.omms/`.
- OMMS deletes folders in the OpenCode cache. A TUI or web app that has run an old copy for more than 24 hours can fail to load a module until it restarts.
- Two update modules exist until Claude Code moves onto the shared one.

Neutral:

- Pinned installs and local checkouts keep the notice-only behaviour.
- Pi updates in place and needs no clean-up.

## References

- [Updating and upgrading](../upgrading.md#updating-omms)
- [TDR-071](../tdr/071-opencode-update-live-check-findings.md)
- `src/services/host-self-update.ts`
