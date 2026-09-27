# TDR-008: Copy OpenCode databases asynchronously and share one copy per source

**Date:** 2026-09-27
**Status:** Accepted
**Deciders:** Aizat Hawari
**Supersedes:** TDR-003
**Tags:** sqlite, wal, history-import, web-settings

## Context

TDR-003 reads a WAL-mode `opencode.db` through a private copy. That copy used `copyFileSync` with up to five attempts, one copy per run, and cleanup only when the run ended. The web Settings page changed the load:

- The web server runs inside the OpenCode process, so a synchronous copy blocks the web UI and live capture for the whole copy.
- Listing, preview, and import each read the database, which meant three copies.
- Users import backups of about 8 GB from an external drive. A copy across devices is a full byte copy, and five attempts can read about 40 GB.
- A process that quits mid-import left a multi-gigabyte folder in the temporary directory.

## Decision

`src/importer/opencode-snapshot.ts`:

1. **Free space first.** `statfsSync(tmpdir())` must show the database plus the WAL plus the larger of 256 MB and 10%. Otherwise fail before copying, with both sizes.
2. **Asynchronous, cancellable copy.** Try a copy-on-write clone (`COPYFILE_FICLONE_FORCE`), then fall back to a streamed copy with an `AbortSignal`.
3. **Attempts.** Five when the source is on the temporary folder's device and at most 1 GB; otherwise one. The error then says to quit OpenCode or use a checkpointed backup.
4. **Shared copies.** `OpencodeSnapshotRegistry` keeps one copy per source (real path, device, inode), with reference counts and a 30-minute idle limit. A listing refresh makes a new copy; preview and import reuse it and fail as stale if it expired. A job still reading an older copy keeps it until it releases it. A finished real import discards the copy.
5. **Cleanup.** Each folder holds `owner.json` with the process ID. Server shutdown removes all copies. Web server start, and every new copy, delete folders whose owner process is gone.
6. **No-WAL reads.** A database without a WAL is still read in place with `immutable=1`. A `-journal` file refuses the read as busy. If a WAL appears or the file changes during the in-place listing, the reader switches to a copy.

The CLI and slash commands take an unshared copy that is removed when the run ends. The OpenCode importer builds turns one session at a time, so a large selection does not hold every turn in memory.

## Consequences

### Positive

- The web UI and live capture keep responding during a copy (tested with a streamed 32 MB copy).
- A list, preview, and import of an 8 GB database copy it once.
- Space problems appear before any copy; orphaned copies disappear on the next start.

### Negative

- A shared copy can use disk space for up to 30 minutes after the last use.
- A refresh while a job runs briefly needs space for two copies.
- A busy live database on another device may need OpenCode to be quit.

### Neutral

- OpenCode's database, `-wal`, and `-shm` stay byte-for-byte unchanged, as in TDR-003.

## Alternatives Considered

| Option                                | Rejected Because                                                  |
| ------------------------------------- | ----------------------------------------------------------------- |
| Keep `copyFileSync`                   | Blocks the OpenCode process for the length of the copy.           |
| Copy next to the source on its volume | Writes into the user's history folder or backup drive.            |
| One copy per request                  | Three full copies for one import.                                 |
| Read the live file without a copy     | Either misses the WAL (`immutable=1`) or writes `-shm` (TDR-003). |

## How to Recognise / Handle This Again

1. Symptom: "Not enough temporary space" or "changed while it was copied" in the page or CLI.
2. Check: free space in the temporary folder, and `ls -la <db>*` for a large `-wal`.
3. Free space, quit OpenCode, or import from a checkpointed backup, then list again.

## Revisit Triggers

OpenCode storage changes, Node gaining a read-only WAL open that never writes `-shm`, or databases too large to copy at all.

## References

- `src/importer/opencode-snapshot.ts`, `src/importer/opencode-reader.ts`
- `tests/opencode-snapshot.test.ts`, `tests/opencode-web-selection.test.ts`
- [ADR-008](../adr/008-session-first-web-import.md), TDR-003
