## MODIFIED Requirements

### Requirement: Memory search can reorder candidates with a reranker

When the reranker is on, a memory search SHALL:

1. Score memories as it does today and take the 50 best by that score, with no similarity threshold applied.
2. Send the query and the text of those candidates to `<rerankerApiUrl>/rerank` as a JSON `POST` with `model`, `query`, `documents`, and `top_n` equal to the number of documents. Each document SHALL be cut to 4,000 characters.
3. Order the candidates by the returned `relevance_score`, highest first, with ties broken by memory id.
4. Return the first `maxMemories` of them.

The search SHALL send the key as a bearer token when `rerankerApiKey` is set. The same steps SHALL apply to prompt retrieval and to manual memory search, because both use the shared search. Session-memory lists SHALL NOT change.

#### Scenario: Reranker lifts a memory above the threshold

- **WHEN** the reranker is on and the best candidate scores 0.42 on similarity with a reranker score of 0.9
- **THEN** that memory SHALL be returned even though 0.42 is below `similarityThreshold`

#### Scenario: Result count

- **WHEN** `maxMemories` is 6 and the reranker returns scores for 50 candidates
- **THEN** search SHALL return the 6 with the highest reranker scores

#### Scenario: Every host

- **WHEN** the reranker is on
- **THEN** OpenCode V2, Pi, and Claude Code SHALL each use it for prompt retrieval
- **AND** no host SHALL need its own setting
