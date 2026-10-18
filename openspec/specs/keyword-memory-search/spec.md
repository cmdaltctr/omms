# keyword-memory-search Specification

## Purpose

Defines how memory search uses the words of a prompt, so a memory that contains a rare term, an identifier, or a file name can be found even when its meaning is not close to the prompt.

## Requirements

### Requirement: Search matches the words of a prompt

Memory search SHALL match the words of the query against the text and the tags of each stored memory. A memory that contains a query word SHALL receive a boost to its similarity. A memory that the vector search did not return but that contains a query word SHALL be a candidate for the result. The boost SHALL be larger for a word that is rare in the searched memories and SHALL NOT exceed the `keywordBoost` setting.

#### Scenario: Identifier in the prompt

- **WHEN** a memory contains `ADR-023` and the prompt says "why did we write adr 023"
- **THEN** that memory SHALL be among the candidates
- **AND** its similarity SHALL include a keyword boost

#### Scenario: Weak match without the word

- **WHEN** a memory does not contain any word of the prompt
- **THEN** its similarity SHALL equal the score it had without keyword matching

#### Scenario: Boost is bounded

- **WHEN** a memory matches every word of the prompt
- **THEN** its similarity SHALL be at most its score without the boost plus `keywordBoost`
- **AND** SHALL NOT exceed 1

### Requirement: The boost is configurable and can be turned off

The `keywordBoost` setting SHALL accept a number from 0 to 0.5. A value of 0 SHALL make search behave as it did before this change, without reading the keyword index. A missing setting SHALL use the default in the documentation. An invalid value SHALL be refused with the other invalid settings.

#### Scenario: Turned off

- **WHEN** `keywordBoost` is 0
- **THEN** search results SHALL equal the results without keyword matching

### Requirement: The mode that joins word matches to the results is configurable

The `keywordMode` setting SHALL accept `boost` or `rrf`. A missing setting SHALL be `boost`. An invalid value SHALL be refused with the other invalid settings. `keywordBoost` of 0 SHALL turn keyword matching off in both modes.

#### Scenario: Default mode

- **WHEN** `keywordMode` is not set
- **THEN** search SHALL use the additive boost

#### Scenario: Invalid mode

- **WHEN** `keywordMode` is `fusion`
- **THEN** the setting SHALL be refused

### Requirement: Rank fusion mode merges a meaning list and a word list by rank

When `keywordMode` is `rrf` and `keywordBoost` is above 0, search SHALL build a meaning list from the memories whose similarity is at or above `similarityThreshold`, ranked by similarity, and a word list from the memories that contain a word of the query, ranked by match strength, at most 40. It SHALL merge the two lists by reciprocal rank fusion with constant 60 and return the best results up to the memory limit. A memory found only in the word list MAY be returned although its similarity is below the threshold. Each result SHALL keep its own similarity score. The fusion SHALL NOT call a model or an embedding service.

#### Scenario: Word match below the cut-off

- **WHEN** a memory holds a query word and its similarity is below `similarityThreshold`
- **THEN** it MAY be returned in `rrf` mode
- **AND** it SHALL NOT be returned in `boost` mode unless its boosted similarity reaches the threshold

#### Scenario: Memory in both lists

- **WHEN** a memory is in both lists
- **THEN** it SHALL rank above a memory that has the same rank in only one list

#### Scenario: No word matches

- **WHEN** no memory holds a query word
- **THEN** `rrf` mode SHALL return the memories of the meaning list in their order

### Requirement: The reranker takes precedence over rank fusion

When the reranker is on, search SHALL use the additive boost whatever `keywordMode` says.

#### Scenario: Reranker on

- **WHEN** `rerankerEnabled` is true and `keywordMode` is `rrf`
- **THEN** search SHALL use the additive boost
- **AND** the Memory page SHALL tell the user that `rrf` is not used

### Requirement: The keyword index is derived and repairs itself

Each project shard SHALL keep a keyword index that OMMS builds from the stored memories. The index SHALL follow saves, edits, and deletes. When a shard has no index, or the index holds a different number of memories than the shard, OMMS SHALL rebuild it before the next keyword search in that shard. The index SHALL NOT be needed to read, export, or copy memories.

#### Scenario: Existing shard

- **WHEN** a shard saved before this change is searched for the first time
- **THEN** the keyword index SHALL be built
- **AND** the memories in the shard SHALL be unchanged

#### Scenario: Edit and delete

- **WHEN** a memory's text is edited so it no longer holds a word, or the memory is deleted
- **THEN** a later search for that word SHALL NOT match it

### Requirement: Keyword search never makes a search fail

When the keyword index cannot be built or read, search SHALL continue with the vector and tag results, SHALL log a code without memory or prompt text, and SHALL return results. A query made only of characters the index cannot use SHALL behave as a query with no keyword match. Query text SHALL NOT be run as index syntax.

#### Scenario: Index error

- **WHEN** the keyword index fails to build in a shard
- **THEN** search in that shard SHALL return vector and tag results

#### Scenario: Syntax characters in a prompt

- **WHEN** the prompt contains `"`, `*`, `(`, `AND`, or `NEAR`
- **THEN** search SHALL return results and SHALL NOT raise a query error

### Requirement: Retrieval adds no model call and no extra embedding

Keyword matching SHALL NOT call a model or an embedding service. The prompt SHALL be embedded once per retrieval, as before.

#### Scenario: Call count

- **WHEN** a hook retrieves memories for a prompt
- **THEN** the number of embedding requests SHALL equal the number before this change
- **AND** no model request SHALL be made
