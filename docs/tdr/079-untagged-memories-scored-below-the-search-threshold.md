# TDR-079: Untagged memories scored below the search threshold

**Date:** 2026-11-11
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** search, scoring, tags

## Context

During the `drop-opencode-v1` live check, an agent added a memory with no tags, then searched for it at once with the query "WAL mode". The search returned nothing. The same memory was found in the next session through a longer query.

### Root Cause Analysis (if debugging-driven)

Vector search blends two scores for a normal memory: 60% content similarity and 40% tag similarity (`src/services/turso/vector-search.ts`). A memory with no tags has no tags vector, so its tag similarity is 0. Its score can never exceed 0.6 of its content match.

The query "WAL mode" matched the content at about 83%. The blend gave 0.6 × 0.83 ≈ 0.498, just below the 0.5 threshold for `qwen3-embedding:0.6b`. The installed 5.10.1 release gives the same result, so the fault is older than this change. It is not a write-timing fault: the memory was stored and indexed.

## Decision

Score an untagged memory by its content alone. A memory is untagged when it has no tags vector and an empty tags column. Tagged memories keep the 60/40 blend. Memorisations already use content alone (ADR-047), so the rule now covers both cases where the tags half carries no signal.

## Consequences

### Positive

- An agent can find a memory it saved without tags with a short query.
- "WAL mode" now returns the memory at 76%.

### Negative

- An untagged memory can now outrank a tagged one with the same content match, when the tagged memory's tags do not match the query.

### Neutral

- No stored data changes. The score is computed at search time.

## Alternatives Considered

| Option                                                      | Rejected Because                                       |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Lower `similarityThreshold`                                 | Every tagged memory would also pass at weaker matches. |
| Give untagged memories the content score as their tag score | Same result as content alone, with a less direct rule. |
| Generate tags on every add                                  | Needs a model call on each add; out of scope.          |

## How to Recognise / Handle This Again

A memory is in the store (`memory list` shows it) but `memory search` with a reasonable query returns nothing. Run the search with `similarityThreshold` 0 and read the score. A score close to 0.6 × the expected content match means the tags half is empty.

## Revisit Triggers

- Search starts generating tags for every memory.
- The 60/40 blend changes.

## References

- `src/services/turso/vector-search.ts`
- `tests/turso-vector-search.test.ts` ("scores an untagged memory by content alone and keeps the blend for a tagged one")
- [ADR-047](../adr/047-memorisations-are-a-record-kind-in-the-memory-store.md)
