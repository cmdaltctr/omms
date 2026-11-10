# TDR-077: Ordinary search missed normal memories behind memorisations

**Date:** 2026-11-10
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memorisation, search, vector-search

## Context

Ordinary search must return normal memories only. Memorisations are records with `type = 'memorisation'` in the same table. A test with more than 128 memorisations close to the query returned no normal memory, although four matched the project.

This is the mirror image of [TDR-073](./073-text-recall-missed-memorisations-behind-the-ann-candidates.md).

### Root Cause Analysis

1. `vector_top_k(index, query, k)` returns at most `k` candidates from every row of the shard. `k` is `max(limit * 16, 128)` for a project search.
2. The `WHERE` clause (project tag and `memoryKindPredicate`) runs on those candidates, after the index chose them.
3. When `k` or more memorisations sit closer to the query than the normal rows, they fill every candidate. The filter removes them all and the search returns fewer rows than the limit, or none.

The result is a silent miss.

## Decision

In `src/services/turso/vector-search.ts`, `searchInShard` passes `limit` to `searchKind`. When the filtered ANN result holds fewer rows than `limit`, `searchKind` calls `exactScanKind` (`src/services/turso/exact-scan.ts`). The exact scan applies the kind and project filters in SQL, so no candidate cap applies.

The common case keeps the ANN index. The exact scan runs only when the ANN result is short.

Regression test: `tests/memorisation-ordinary-search-ann.test.ts`. It inserts 140 memorisations close to the query and four normal memories that are farther. It expects three normal memories back. The test fails when the short-result check is removed.

## Consequences

### Positive

- Ordinary search returns normal memories however many memorisations are close.

### Negative

- A project that holds fewer than `limit` matching rows runs the exact scan each time. The scan is cheap for a small project.

### Neutral

- Memorisation-kind search and the fallback when `vector_top_k` fails are unchanged.

## Alternatives Considered

| Option                        | Rejected Because                                                 |
| ----------------------------- | ---------------------------------------------------------------- |
| Raise `k` for ordinary search | Any fixed `k` can still be filled by closer memorisations.       |
| Always use the exact scan     | It reads every vector of the project and loses the ANN speed.    |
| Loop with a growing `k`       | More code and more queries than one exact scan on the rare path. |

## How to Recognise / Handle This Again

1. Symptom: ordinary search returns fewer rows than the limit, or none, in a project that holds many memorisations.
2. Check that `searchKind` still falls back to `exactScanKind` when the ANN result is shorter than `limit`.
3. Run `bash scripts/run-tests-isolated.sh tests/memorisation-ordinary-search-ann.test.ts`.

## Revisit Triggers

- Turso adds a filtered ANN search that applies the `WHERE` clause before the candidate cap.
- A large project often holds fewer matching rows than `limit`, and the exact scan becomes slow.

## References

- [TDR-073](./073-text-recall-missed-memorisations-behind-the-ann-candidates.md)
- `src/services/turso/vector-search.ts`, `src/services/turso/exact-scan.ts`
- `tests/memorisation-ordinary-search-ann.test.ts`
