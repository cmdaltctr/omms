# TDR-012: Tag migration touches only untagged memories

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** web-ui, embeddings, migration

## Context

The web UI's **Memory Tagging Migration** dialog reports how many memories have no tags ("Found 1 memories needing technical tags") and offers **Start Migration**. On a store with 2,236 memories and one untagged memory, the run showed `/2236` and worked through every memory.

### Root Cause Analysis

`handleDetectTagMigration` counted only rows with empty `tags`, but `handleRunTagMigrationBatch` loaded `SELECT * FROM memories` from every project shard and re-embedded each row's content and tags, calling the model only for the untagged ones. Tagged memories got identical vectors back, so no data was lost, but the run took far longer than the dialog implied and ran the local embedding model thousands of times. A second defect: a memory that threw an error did not advance `processed`, so every later batch restarted at the same memory and the run could never finish.

## Decision

The run builds its work list once, when it starts, from `SELECT id FROM memories WHERE tags IS NULL OR tags = ''` in each project shard, so the total matches the dialog's count. Each memory is re-read by id; one that gained tags or was deleted since is passed over. Only a memory that receives tags is re-embedded. Its tags and both vectors are saved in one `UPDATE`, so a failed embedding leaves it untagged and a later run tries it again. A failure is recorded in `errors` and the run always moves on. When a run completes, the next run starts from a fresh list of whatever is still untagged.

## Consequences

### Positive

- The dialog's count and the run's total agree, and tagged memories are never rewritten.
- A failing memory cannot stall the run; it stays untagged for a later run.

### Negative

- A memory whose model call fails stays untagged, so the dialog reappears until a run succeeds.

### Neutral

- Migration state is still held in the web server's memory; restarting the server restarts the run.

## Alternatives Considered

| Option                              | Rejected Because                                                 |
| ----------------------------------- | ---------------------------------------------------------------- |
| Keep re-embedding everything        | Wastes time and CPU, and contradicts the dialog's count          |
| Select untagged rows on every batch | Rows that fail stay untagged and would be selected again forever |

## How to Recognise / Handle This Again

1. A migration or backfill total is much larger than the count shown before it starts.
2. Compare the detect query with the query the run iterates over.
3. Build the run's list from the same filter as the detect step, and always advance past failures.

## Revisit Triggers

- Tags or tag vectors change format and existing tagged memories need re-embedding on purpose.

## References

- `src/services/api-handlers.ts` (`handleDetectTagMigration`, `handleRunTagMigrationBatch`)
- `tests/tag-migration.test.ts`
