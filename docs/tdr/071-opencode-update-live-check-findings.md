# TDR-071: The live check of the OpenCode update found four faults

**Date:** 2026-11-07
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** opencode, pi, self-update, cache, live-check

## Context

The change `pi-opencode-auto-update` (ADR-045) makes Pi and OpenCode run their own update command. A live check on 2026-11-07 used OpenCode 2.2.5 in a scratch home folder. It found four faults. Unit tests had passed because they used the folder layout and the exit code that the code expected.

### Root Cause Analysis

1. **Every OpenCode install counted as pinned.** OpenCode 2.2 stores each plugin install in a new `<timestamp>` folder between `om-memory-system@latest/` and `node_modules/`. The pin check read the folder just above `node_modules`. It saw a number, not `om-memory-system@latest`, so it skipped the update every time.
2. **A restart did not load the new copy.** The OpenCode background service keeps the old copy loaded after the TUI restarts. Only `opencode service restart` loads the new copy. The first toast said only "restart OpenCode".
3. **Each update added about 900 MB.** OpenCode never removes old `<timestamp>` folders.
4. **`installed` could be wrong.** OMMS recorded `installed` from the exit code alone. The host command can exit with 0 when npm's lock already lists the version and nothing is installed. The footer then said `installed, restart`, and a restart loaded the old copy again.

## Decision

- `unpinnedCacheFolder` in `src/services/host-self-update.ts` skips an all-digit folder name and reads the folder above it.
- The restart toast says "Restart OpenCode and run opencode service restart".
- When the OpenCode background service starts, OMMS removes older OMMS copies in `~/.cache/opencode/npm/om-memory-system@latest/<timestamp>/`. It keeps the running copy, newer copies, the copy in `~/.omms/runtime.json`, and copies without a readable version. It removes nothing while the running copy is less than 24 hours old. A copy that cannot be removed stays. One `OpenCode cache clean-up` log record holds the counts.
- OMMS shows `installed, restart` only after it finds the new version in an installed copy on disk. Otherwise it shows `· <version> available` and the update command. This applies to Pi and OpenCode.

## Consequences

### Positive

- The background update runs on OpenCode 2.2.
- The user sees the full restart steps.
- Each release no longer adds 900 MB that stays for good.
- `installed, restart` is true when it appears.

### Negative

- The clean-up depends on OpenCode's cache layout. A new layout turns the clean-up into a no-op. The install check reads the running copy and its readable timestamp siblings in the same cache folder.
- A TUI or web app that runs an old copy for more than 24 hours can fail to load a module until it restarts.

### Neutral

- Pi updates in place and needs no clean-up.

## Alternatives Considered

| Option                                       | Rejected Because                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Check the install inside the detached script | The script is a string with no unit tests, and it would repeat the host paths                     |
| Clean up from the TUI                        | A TUI can start on the new copy while the service still runs the old copy and loads from it later |
| Tell the user to delete old folders by hand  | The disk fills before the user notices                                                            |

## How to Recognise / Handle This Again

1. Symptom: OMMS never starts an update on OpenCode, or the footer shows `installed, restart` and the version does not change after a restart.
2. Check the path of the running module. Compare it with the folders under `~/.cache/opencode/npm/om-memory-system@latest/`.
3. Read `package.json` in each folder. Run `opencode service restart` when the newest folder holds the new version.
4. For disk use, look for the `OpenCode cache clean-up` record in the log. It shows how many folders OMMS removed and kept.

## Revisit Triggers

- OpenCode changes its plugin cache layout again.
- OpenCode starts to remove old plugin folders itself.
- OpenCode reloads plugins in the background service without `opencode service restart`.

## References

- [ADR-045](../adr/045-hosts-update-omms-with-their-own-command.md)
- [Updating and upgrading](../upgrading.md#updating-omms)
- `openspec/changes/archive/2026-11-07-pi-opencode-auto-update/`
- `src/services/host-self-update.ts`
