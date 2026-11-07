# TDR-066: Transfer preview ran vector_extract on a NULL tags_vector

**Date:** 2026-11-06
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memory-spaces, transfer, libsql, vectors

## Context

A transfer preview reads every source row across shards to count matches and duplicates (design D3). The row reader in `src/services/spaces/transfer-service.ts` selects both stored vectors as JSON, so the engine can reuse them when the models match.

### Root Cause Analysis

A memory saved without tags holds NULL in its `tags_vector` column; tags are optional. `vector_extract(NULL)` throws in libSQL, so the preview SELECT failed for any space that holds at least one memory without tags. Most spaces hold one, so almost every preview failed at the first shard.

Evidence: `tests/space-transfer-service.test.ts` seeds a memory without tags (`a-three`), and its `tags_vector` column is NULL. The preview over that space threw before the guard.

## Decision

The SELECT guards the optional column:

```sql
vector_extract(vector) AS vector_json,
CASE WHEN tags_vector IS NULL THEN NULL ELSE vector_extract(tags_vector) END
  AS tags_vector_json
```

`parseExtractedVector(null)` returns undefined, which reads as "no tags vector": the engine embeds the tags text again when it re-embeds, and skips reuse otherwise (the D3 rule). The main `vector` column is always present, so it needs no guard. Preview and copy share the reader, so both are covered.

## Consequences

### Positive

- Preview and copy work over spaces with mixed rows, with and without tags.
- A NULL tags vector flows through the engine as "absent" and never as an error.

### Negative

- The SELECT carries a CASE branch it rarely needs.

### Neutral

- Vector reuse is unchanged: a row without a tags vector simply has none to reuse.

## Alternatives Considered

| Option                               | Rejected Because                                                |
| ------------------------------------ | --------------------------------------------------------------- |
| `COALESCE(tags_vector, ...)`         | `vector_extract` still runs on the NULL inside and still throws |
| Skip the tags vector in the preview  | Copy uses the same reader, so it would need a second query      |
| Filter NULL rows out of the transfer | Memories without tags are normal data and must transfer         |

## How to Recognise / Handle This Again

1. Symptom: a preview fails on a real space with an SQL error naming `vector_extract`.
2. Check whether the column is optional. A vector column written only for some rows must be read behind a NULL guard.
3. Check `tests/space-transfer-service.test.ts` for the seeded row without tags.

## Revisit Triggers

- Another optional vector column joins the shard schema.
- The row reader moves to a new query or a new store module.
