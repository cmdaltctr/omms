# TDR-001: Read OpenCode's live SQLite database with immutable node:sqlite

**Date:** 2026-09-25
**Status:** Superseded by [TDR-003](./003-snapshot-opencode-wal-database.md)
**Deciders:** Project maintainer
**Tags:** sqlite, history-import

## Context

OpenCode V1 stores history in `opencode.db`, sometimes alongside write-ahead-log (`-wal`) and shared-memory (`-shm`) files. The importer must work while OpenCode is open and must leave all three files unchanged. OMMS uses libSQL for its own memory store, but that client does not provide the required immutable SQLite URI read mode for an external database. `node:sqlite` is available in supported Node versions from 22.13 onward; use Node 22.14 or later for this CLI.

## Decision

Open the path as `file:…?immutable=1` with `new DatabaseSync(uri, { readOnly: true })`. Build the URI with `pathToFileURL(dbPath)`. Validate the V1 tables before reading and always close the handle after iteration or failure. Keep OpenCode running. When Node prints an `ExperimentalWarning` for `node:sqlite`, treat it as an API warning, not a schema or import failure. Do not hide other warnings or exceptions.

## Consequences

### Positive

- Reads a live database without changing its WAL or SHM sidecars.
- Fails clearly if the expected V1 schema is missing.

### Negative

- Immutable mode can miss writes that have not reached the main database file. Preview again after OpenCode checkpoints its database if recent sessions are missing.
- The command needs a supported Node runtime.

### Neutral

- The SQLite reader is separate from OMMS's libSQL memory store.

## Alternatives Considered

| Option                                      | Rejected Because                                       |
| ------------------------------------------- | ------------------------------------------------------ |
| Use libSQL for the source                   | It does not expose this immutable SQLite read mode.    |
| Open the source for ordinary SQLite reading | A reader may touch SHM or interact with a live writer. |
| Copy the live database file                 | Copying only the main file can miss WAL data.          |

## How to Recognise / Handle This Again

1. Check the Node version with `node --version`. Use 22.14 or later.
2. If the command reports `Unsupported OpenCode V1 database`, inspect the source schema and check for a V2 migration.
3. If recent sessions are absent, wait for OpenCode to checkpoint or close it, then preview again. Compare database and sidecar checksums before and after a dry-run.
4. An `ExperimentalWarning` alone does not mean that the read failed. Inspect the exit status and session counts.

## Revisit Triggers

Reassess when OpenCode moves to V2 storage, Node changes `node:sqlite` behaviour, or live WAL visibility becomes necessary.

## References

- `src/importer/opencode-reader.ts`
- `tests/opencode-reader.test.ts`
- `docs/opencode-history-import.md`
