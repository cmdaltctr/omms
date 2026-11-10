# TDR-073: Text recall missed memorisations behind the ANN candidates

**Date:** 2026-11-10
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memorisation, recall, vector-search

## Context

`recall` with text must find memorisations only. The first version ran the normal vector search and added the kind filter (`type = 'memorisation'`) to the `WHERE` clause. A test with many normal rows close to the query returned no memorisation, although one matched the project.

### Root Cause Analysis

1. `vector_top_k(index, query, k)` is the ANN index. It returns at most `k` candidates from every row of the shard. `k` is `max(limit * 16, 128)` for a project search.
2. The `WHERE` clause runs on those candidates. The kind filter therefore removes rows after the index already chose them.
3. When 128 or more normal rows sit closer to the query than a memorisation, they fill every candidate. The filter then removes them all, and the memorisation never appears.

The result is a silent miss: the reply says no memorisation matched.

## Decision

In `src/services/turso/vector-search.ts`, `searchKind` skips the index when `kind` is `"memorisation"` and calls `exactScanKind` (`src/services/turso/exact-scan.ts`). The exact scan puts the kind and project filters in the `WHERE` clause and ranks by `vector_distance_cos`, so no candidate cap applies. Normal searches keep the ANN index.

Regression test: `tests/memorisation-recall-ann.test.ts`. It inserts 140 normal rows close to the query (more than the 128 candidates) and one memorisation that is the farthest row. It expects the memorisation back. The test fails when `searchKind` goes back through `vector_top_k` for the memorisation kind.

## Consequences

### Positive

- Recall by text finds a memorisation however many normal memories are close.
- The result is exact, not approximate.

### Negative

- Each text recall reads every memorisation vector of the project.

### Neutral

- Normal searches, and the fallback to the exact scan when `vector_top_k` fails, are unchanged.

## Alternatives Considered

| Option                                 | Rejected Because                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Raise `k` for the memorisation kind    | Any fixed `k` can still be filled by closer normal rows.                                 |
| Filter the kind after the query        | The result limit applies first and drops real matches.                                   |
| A separate ANN index for memorisations | A second index to build, migrate and keep in step. Memorisations are too few to need it. |

## How to Recognise / Handle This Again

1. Symptom: `recall` with text says no memorisation matched, although `recall` with the `ms-` ID returns the record.
2. Check the project holds more than 128 normal memories close to the query, and that `searchKind` still routes the memorisation kind to `exactScanKind`.
3. Run `bash scripts/run-tests-isolated.sh tests/memorisation-recall-ann.test.ts`.

## Revisit Triggers

- A project holds thousands of memorisations and the exact scan becomes slow.
- Turso adds a filtered ANN search that applies the `WHERE` clause before the candidate cap.

## References

- [ADR-047](../adr/047-memorisations-are-a-record-kind-in-the-memory-store.md)
- [TDR-074](./074-memorisation-confidence-scores-were-flattened.md)
- `src/services/turso/vector-search.ts`, `src/services/turso/exact-scan.ts`
- `tests/memorisation-recall-ann.test.ts`
