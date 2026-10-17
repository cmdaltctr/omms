# memory-reranker Specification

## Purpose

Defines the opt-in second stage of memory search. When the user turns it on, an external reranker server reorders the best candidates by relevance. The stage is off by default, never blocks search when the server fails, and sends memory text only to the server the user chose.

## Requirements

### Requirement: The reranker is opt-in and off by default

OMMS SHALL read these settings from the global `~/.config/omms/omms.jsonc`:

| Setting             | Default | Accepted values                                       |
| ------------------- | ------- | ----------------------------------------------------- |
| `rerankerEnabled`   | false   | Boolean                                               |
| `rerankerApiUrl`    | unset   | An `http://` or `https://` URL                        |
| `rerankerModel`     | unset   | A non-empty string                                    |
| `rerankerApiKey`    | unset   | An `env://NAME` or `file://path` secret reference     |
| `rerankerTimeoutMs` | 4000    | Integers from 500 to 30000 inclusive, in milliseconds |

A project file SHALL NOT set or override any of these five settings, because they decide where memory text is sent. The reranker SHALL run only when `rerankerEnabled` is true and both `rerankerApiUrl` and `rerankerModel` are set. An invalid value SHALL fail validation with the setting name and its accepted values, and SHALL NOT include the value in the message.

#### Scenario: Fresh install

- **WHEN** no reranker setting is present
- **THEN** memory search SHALL behave exactly as it did before this change
- **AND** OMMS SHALL make no call to any reranker server

#### Scenario: Switch on without a server

- **WHEN** `rerankerEnabled` is true and `rerankerApiUrl` is unset
- **THEN** OMMS SHALL treat the reranker as off
- **AND** it SHALL log one metadata record with the code `reranker_not_configured`

#### Scenario: A project tries to set the URL

- **WHEN** a project file at `<project>/.opencode/omms.jsonc` sets `rerankerApiUrl`
- **THEN** OMMS SHALL ignore that value
- **AND** the global value SHALL stay in force

#### Scenario: A plain-text key

- **WHEN** the file sets `rerankerApiKey` to a value that is not an `env://` or `file://` reference
- **THEN** validation SHALL refuse it

### Requirement: Memory search can reorder candidates with a reranker

When the reranker is on, a memory search SHALL:

1. Score memories as it does today and take the 50 best by that score, with no similarity threshold applied.
2. Send the query and the text of those candidates to `<rerankerApiUrl>/rerank` as a JSON `POST` with `model`, `query`, `documents`, and `top_n` equal to the number of documents. Each document SHALL be cut to 4,000 characters.
3. Order the candidates by the returned `relevance_score`, highest first, with ties broken by memory id.
4. Return the first `maxMemories` of them.

The search SHALL send the key as a bearer token when `rerankerApiKey` is set. The same steps SHALL apply to prompt retrieval and to manual memory search, because both use the shared search. Recent-memory and session-memory lists SHALL NOT change.

#### Scenario: Reranker lifts a memory above the threshold

- **WHEN** the reranker is on and the best candidate scores 0.42 on similarity with a reranker score of 0.9
- **THEN** that memory SHALL be returned even though 0.42 is below `similarityThreshold`

#### Scenario: Result count

- **WHEN** `maxMemories` is 6 and the reranker returns scores for 50 candidates
- **THEN** search SHALL return the 6 with the highest reranker scores

#### Scenario: Every host

- **WHEN** the reranker is on
- **THEN** OpenCode V1, OpenCode V2, Pi, and Claude Code SHALL each use it for prompt retrieval
- **AND** no host SHALL need its own setting

### Requirement: A reranker failure never blocks search

OMMS SHALL give the reranker call `rerankerTimeoutMs` milliseconds (default 4000). If the server is unreachable, the call exceeds that time, the HTTP status is not a success, or the reply is invalid, search SHALL return the result it would return with the reranker off, using `similarityThreshold`. A reply is valid only when it has one entry for each document, each `index` is an integer inside the document range and appears once, and each `relevance_score` is a finite number. Partial reranking SHALL NOT be used.

Each failure SHALL log one metadata record with a code and the elapsed time. It SHALL NOT log the query, any document text, or the key. Error messages SHALL redact the key.

#### Scenario: Server down

- **WHEN** the reranker is on and the server refuses the connection
- **THEN** search SHALL return the threshold result
- **AND** the log SHALL hold `reranker_unreachable` and no memory text

#### Scenario: Slow server

- **WHEN** the timeout is the default 4000 and the server takes 5 seconds to answer
- **THEN** search SHALL return the threshold result after about 4 seconds

#### Scenario: Longer timeout

- **WHEN** `rerankerTimeoutMs` is 6000 and the server answers in 3 seconds
- **THEN** search SHALL use the reranked order

#### Scenario: Invalid timeout

- **WHEN** the file sets `rerankerTimeoutMs` to 499, 30001, 2000.5, `null`, or a string
- **THEN** validation SHALL refuse it with the setting name and accepted range

#### Scenario: Short reply

- **WHEN** the server returns scores for 49 of 50 documents
- **THEN** search SHALL return the threshold result
- **AND** the log SHALL hold `reranker_invalid_reply`

### Requirement: The reranker sends memory text only to the chosen server

OMMS SHALL send the query and candidate memory text only to `rerankerApiUrl`. It SHALL NOT bundle, download, or start a reranker model or server. The documentation SHALL state that the prompt and candidate memories leave the process, SHALL recommend a server on the same machine, and SHALL show how to run one.

#### Scenario: Reading the log

- **WHEN** the reranker is on and a search completes
- **THEN** the log SHALL hold at most the candidate count, the elapsed time, and a code
- **AND** it SHALL NOT hold the query or any memory text
