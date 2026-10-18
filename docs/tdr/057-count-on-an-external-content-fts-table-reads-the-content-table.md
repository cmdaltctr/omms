# TDR-057: COUNT(*) on an external-content FTS table reads the content table

- **ID:** TDR-057
- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** sqlite, fts5, turso, index-repair

## Context

The keyword index (`memories_fts`, see [ADR-034](../adr/034-hook-search-uses-a-keyword-index-and-relevant-profile-items.md)) is an external-content FTS5 table over `memories`. The first version of the repair guard compared `SELECT COUNT(*) FROM memories_fts` with `SELECT COUNT(*) FROM memories`. A test that deleted index rows by hand, with the triggers still in place, did not trigger a rebuild.

### Root Cause Analysis

For an external-content table, `COUNT(*)` on the FTS table reads the content table (`memories`), not the index. Both counts were always equal, so the guard never saw a short index. Searches then missed the memories that were absent from the index.

## Decision

- The guard counts rows in `memories_fts_docsize`, which holds one row for each document the index really contains, and compares that number with `COUNT(*)` on `memories`.
- The guard first checks that the table and all three triggers exist. A missing trigger also forces a rebuild.
- The rebuild runs `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` in one transaction, together with the table and trigger setup.
- `tests/keyword-search-shard.test.ts` has a test for each case: a missing trigger, and a short index with the triggers present.

## Consequences

**Positive**

- A short or missing index is repaired on the next search.

**Negative**

- The guard depends on the name of an FTS5 shadow table (`_docsize`). A future SQLite change to that table would break the guard, and the test above would fail.

## References

- [ADR-034](../adr/034-hook-search-uses-a-keyword-index-and-relevant-profile-items.md)
- `src/services/turso/keyword-search.ts` (`indexIsCurrent`)
