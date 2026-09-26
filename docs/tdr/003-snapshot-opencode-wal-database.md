# TDR-003: Read WAL-mode OpenCode databases through a consistent temporary copy

**Date:** 2026-09-26
**Status:** Accepted
**Deciders:** Project maintainer
**Supersedes:** TDR-001
**Tags:** sqlite, wal, history-import

## Context

TDR-001 opened `opencode.db` with `?immutable=1` so the import could not change the database or its `-wal`/`-shm` sidecars. A CodeRabbit review on PR #12 flagged that this also hides every turn OpenCode has not yet checkpointed. OpenCode runs in WAL mode and keeps recent history in `-wal`, so the newest sessions went missing from imports without any warning.

### Root Cause Analysis

With `immutable=1`, SQLite treats the file like a temporary file. It skips locking and never opens the `-wal` file. Reproduction on Node 26 (`node:sqlite`): checkpoint one row, insert a second, then read both ways.

```text
immutable rows 1   # WAL-only row missing
readOnly rows 2
```

A normal `readOnly` open reads the WAL but writes to `-shm` (recovery, read marks), and it creates `-shm` when none exists. That breaks the "leave OpenCode's files byte-for-byte unchanged" rule that the tests enforce.

## Decision

`openSnapshot()` in `src/importer/opencode-reader.ts`:

1. No `-wal` file: every committed page is in the main file. Open it in place with `immutable=1`, as before.
2. A `-wal` file exists: `mkdtemp` a private folder and copy `opencode.db` and `opencode.db-wal` into it. Leave `-shm` behind; SQLite rebuilds it. Compare `size:mtimeNs` of both source files before and after the copy. If either changed, OpenCode wrote or checkpointed mid-copy, so discard the copy and retry, up to 5 times, then fail with "retry the import". Open the copy normally.
3. Close the handle and delete the temporary folder when iteration ends or reading fails.

The importer resolves `--project` before opening the reader, so an invalid project cannot leak a copy.

## Consequences

### Positive

- Recent, uncheckpointed turns are imported while OpenCode stays open.
- OpenCode's database, `-wal` and `-shm` stay byte-for-byte unchanged (tested).

### Negative

- Each import briefly needs free space in the temp directory for a full copy of the database.
- Very heavy concurrent writing can exhaust the retries; rerun the import.

### Neutral

- A database without a WAL is still read in place.

## Alternatives Considered

| Option                               | Rejected Because                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Keep `immutable=1`                   | Silently misses uncheckpointed history.                                         |
| `readOnly: true` without `immutable` | Writes to OpenCode's `-shm` and creates it when missing.                        |
| SQLite backup API from the live file | Needs a normal open of the source, so it has the same `-shm` writes.            |
| Copy without the stamp check         | A checkpoint between the two copies can pair an old WAL with a newer main file. |

## How to Recognise / Handle This Again

1. Symptom: a dry run shows fewer sessions or units than OpenCode shows, and the missing ones are the newest.
2. Check: `ls -la ~/.local/share/opencode/opencode.db*`. A large `-wal` file means recent history lives only there.
3. Test: `tests/opencode-reader.test.ts` "reads a session that exists only in the WAL" must pass. If "kept changing while it was copied" appears, pause OpenCode activity and rerun.

## Revisit Triggers

OpenCode moving to V2 storage or leaving WAL mode; Node adding a read-only WAL mode that never writes `-shm`; databases large enough that a temp copy is impractical.

## References

- `src/importer/opencode-reader.ts` (`snapshotWalDatabase`, `openSnapshot`)
- `tests/opencode-reader.test.ts`, `tests/opencode-import.test.ts`
- PR #12 review thread on `opencode-reader.ts`
- TDR-001
