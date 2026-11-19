# TDR-088: VACUUM INTO doubled the vector index metadata

**Date:** 2026-11-19
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** spaces, backup, libsql, vector-search

## Context

A space backup copies each SQLite file with `VACUUM INTO` (`snapshotDatabase` in `src/services/storage/snapshot.ts`). The copy is one consistent snapshot while other connections write.

Every shard copy failed libSQL's full `PRAGMA integrity_check` with this line:

```text
row not in PRIMARY KEY order for libsql_vector_meta_shadow
```

The source shard passed. Reads, vector search, writes and `quick_check` worked on the copy, so no user saw a fault. The characterisation test pinned the broken line as known behaviour.

### Root Cause Analysis

- `libsql_vector_meta_shadow` is a `WITHOUT ROWID` table with one row per vector index: the index name and its settings.
- `VACUUM INTO` first replays each `CREATE INDEX` in the new file. For a `libsql_vector_idx` index, that step writes the index's metadata row. Then the vacuum copies every table, `libsql_vector_meta_shadow` too, and appends the same rows again.
- The copy then holds each metadata row twice. A shard has two vector indexes (`memories_vec_idx`, `memories_tags_vec_idx`), so the copy holds four rows out of key order.
- Proof: a 20-row fixture with one vector index gives two identical rows in the copy and the line above. The source has one row.

## Decision

`snapshotDatabase` repairs the copy after `VACUUM INTO`. It opens only the destination file. When the copy has `libsql_vector_meta_shadow`, it runs one write batch:

```sql
CREATE TEMP TABLE vector_meta_once AS SELECT name, metadata FROM libsql_vector_meta_shadow;
DELETE FROM libsql_vector_meta_shadow;
INSERT INTO libsql_vector_meta_shadow SELECT name, metadata FROM vector_meta_once GROUP BY name;
DROP TABLE vector_meta_once;
```

The duplicate rows are byte-identical, so the copy keeps one row for each index. The `GROUP BY` runs on the plain temp table. A `GROUP BY` on the damaged table trusts its broken key order and keeps duplicates when there are two indexes; the first attempt failed with `UNIQUE constraint failed`.

`tests/snapshot-integrity.test.ts` builds a shard with two vector indexes. It checks that the copy passes `integrity_check`, keeps all 20 rows and returns the same `vector_top_k` neighbours as the source, and that the source bytes do not change. `tests/space-store-snapshot-characterisation.test.ts` now expects `ok` for every database in a backup taken mid-write.

## Consequences

### Positive

- Every backup copy passes libSQL's full `integrity_check`, so a check after restore gives a clear answer.
- The source file is never written.

### Negative

- Each shard copy needs a second connection and a small write after the vacuum.

### Neutral

- Files without vector indexes, such as `metadata.db`, are not touched, so their copies stay byte-identical to the vacuum output.
- Backups taken before this fix still hold the duplicate rows. They work, but fail the full `integrity_check`.

## Alternatives Considered

| Option                                      | Rejected Because                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| SQLite online backup API                    | `libsql` 0.5.29 (under `@libsql/client` 0.17.4) throws `not implemented` from `Database.backup()` |
| Copy the file bytes                         | Not a consistent snapshot while other connections write                                           |
| `GROUP BY name` on the damaged table        | Trusts the broken key order and keeps duplicates with two vector indexes                          |
| Leave the copy and check with `quick_check` | Hides real damage that only the full check finds                                                  |

## How to Recognise / Handle This Again

1. Symptom: a copy of a shard fails `PRAGMA integrity_check` with `row not in PRIMARY KEY order for libsql_vector_meta_shadow`, while the source passes.
2. Run `SELECT name, hex(metadata) FROM libsql_vector_meta_shadow` on the copy. Duplicate names confirm this cause.
3. Repair a copy with the batch in the Decision section. Never run it on a live store.

## Revisit Triggers

- The libSQL driver implements `Database.backup()`.
- A libSQL release stops `VACUUM INTO` from doubling the metadata rows. Then remove the repair.
