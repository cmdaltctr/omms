# TDR-074: Memorisation confidence scores were flattened by the shared tag

**Date:** 2026-11-10
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** memorisation, recall, scoring

## Context

`recall` with text returns one match alone when it scores 80 or more and leads the next by 10 points or more. In a test with real embeddings, a near-exact query for a stored note scored 76. The rule never fired, so three matches came back instead of one.

### Root Cause Analysis

1. Normal search scores a hit as `contentSim * 0.6 + tagsSim * 0.4`.
2. Every memorisation carries the same tag, `memorisation`. Its `tags_vector` is therefore almost the same for every record.
3. The tags half is near constant, so it pulls every score towards one value. A close match loses points and a poor match gains them. The spread that the 80-point and 10-point-lead rules need is gone.

## Decision

In `src/services/turso/vector-search.ts`, the score is the content similarity alone when `kind` is `"memorisation"`:

```ts
const base = kind === "memorisation" ? contentSim : contentSim * 0.6 + finalTagsSim * 0.4;
```

Normal searches keep the blend.

Measured with real embeddings, as scores out of 100, with the blend on the left and the content-only score on the right:

| Query type | Blended to content-only |
| ---------- | ----------------------- |
| Exact      | 83 to 100               |
| Near-exact | 76 to 98                |
| Paraphrase | 70 to 90                |

The blend pulls every score towards one value. Content-only scoring gives the full spread, so the near-exact query clears the 80-point rule.

Regression test: `tests/memorisation-recall-confidence.test.ts`. It stores three unrelated notes. It expects a near-exact query and the exact text each to return exactly one match, and the near-exact match to score at least 80. It expects a paraphrase to rank the right note first. The first two cases fail when the memorisation kind goes back to the blended score.

## Consequences

### Positive

- A close query returns one match, and a vague query returns the usual three.
- The score shown to the user reflects the content only.

### Negative

- A memorisation tag never helps its rank. Labels still filter through `tags` in `recall`, but they do not add score.

### Neutral

- Normal search scores are unchanged.

## Alternatives Considered

| Option                                  | Rejected Because                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Lower the 80-point threshold            | It hides the flattening. A wrong ranking would still pass the rule more often.     |
| Remove the shared tag from the vector   | The tag feeds keyword search and the marker. Changing it touches every stored row. |
| Lower the tags weight for memorisations | Any weight above zero still pulls scores together.                                 |

## How to Recognise / Handle This Again

1. Symptom: a near-exact recall query scores below 80 and returns three matches.
2. Check that `vector-search.ts` uses `contentSim` alone for the memorisation kind.
3. Run `bash scripts/run-tests-isolated.sh tests/memorisation-recall-confidence.test.ts`. The first run downloads the embedding model.

## Revisit Triggers

- The embedding model changes. Re-check the 80-point and 10-point-lead thresholds against new score ranges.
- Memorisations get a second tag that differs per record.

## References

- [ADR-047](../adr/047-memorisations-are-a-record-kind-in-the-memory-store.md)
- [TDR-073](./073-text-recall-missed-memorisations-behind-the-ann-candidates.md)
- `src/services/turso/vector-search.ts`, `src/core/memorisation.ts` (`pickRecallMatches`)
- `tests/memorisation-recall-confidence.test.ts`
