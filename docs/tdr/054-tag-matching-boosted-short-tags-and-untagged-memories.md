# TDR-054: Tag matching boosted short tags and untagged memories

- **ID:** TDR-054
- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** retrieval, tags, search, bug

## Context

Search scores a memory as 0.6 × content similarity + 0.4 × the larger of tag-vector similarity and a word match. The word match in `src/services/turso/vector-search.ts` used two-way substring tests: `tag.includes(word) || word.includes(tag)`.

### Root Cause Analysis

- A short tag such as `ui` matched words such as `build` and `guide`, which raised weak results.
- A memory with no tags has the tag list `[""]`. Every word "contains" an empty string, so it got the full tag score (+0.4). The user's store has no untagged memories (0 of 4,654 counted), so this did not show in live results. One existing test expected a score above 0.9 only because of it.

## Decision

Matching moved to `src/services/turso/tag-match.ts` (`tagMatchBoost`). A query word matches when it equals a whole tag or one part of a hyphenated tag (`code` matches `claude-code`). Tags in Han, Hiragana, Katakana, or Thai still match inside a query, because those scripts have no spaces. A test file checks each case. The old test now expects 0.6 for an untagged memory.

## Consequences

**Positive**

- Short tags no longer raise unrelated memories. Untagged memories get no tag credit.

**Negative**

- A memory that matched only through a substring (`config` against `configuration`) now scores lower. Retrieval quality was not measured before and after.

**Neutral**

- The default threshold (0.5) is unchanged.

## Alternatives Considered

| Option                        | Rejected because                                |
| ----------------------------- | ----------------------------------------------- |
| Raise the minimum word length | Keeps `ui`-style false matches for longer words |
| Stemming                      | Adds a dependency for a small gain              |

## How to Recognise / Handle This Again

- Symptom: weak memories rank high for prompts that contain common words.
- Check `bash scripts/run-tests-isolated.sh tests/tag-match-boost.test.ts`.
- If recall drops, compare scores with and without the change on saved prompts before loosening the rule.

## Revisit Triggers

- A keyword index (FTS5) joins vector search. It may replace the tag word match.

## References

- `src/services/turso/tag-match.ts`, `tests/tag-match-boost.test.ts`, `tests/turso-vector-search.test.ts`
- [ADR-033](../adr/033-chat-uses-the-model-to-plan-search-hooks-do-not.md)
