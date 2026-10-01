## Purpose

How OMMS chooses the embedder that turns memory text into search vectors, how a candidate embedder is tested, and how a change re-embeds every stored memory so search keeps working.

## ADDED Requirements

### Requirement: Two kinds of embedder

OMMS SHALL embed text with either a built-in model, which it downloads and runs itself, or an OpenAI-compatible embeddings server. A set `embeddingApiUrl` SHALL select the server. `embeddingApiKey` SHALL be optional: when set, OMMS SHALL send it as a bearer token; when empty, OMMS SHALL send no authorisation header. The server SHALL be called at `<embeddingApiUrl>/embeddings` with `embeddingModel` as the model.

#### Scenario: A local server without a key

- **WHEN** `embeddingApiUrl` is `http://localhost:11434/v1`, `embeddingModel` is `qwen3-embedding:0.6b`, and `embeddingApiKey` is empty
- **THEN** OMMS SHALL call the server without an authorisation header

#### Scenario: A hosted server with a key

- **WHEN** `embeddingApiUrl` is `https://openrouter.ai/api/v1` and `embeddingApiKey` is set
- **THEN** OMMS SHALL send the key as a bearer token

#### Scenario: No server

- **WHEN** `embeddingApiUrl` is empty
- **THEN** OMMS SHALL use the built-in model named by `embeddingModel`

### Requirement: A candidate embedder can be tested

OMMS SHALL test a candidate embedder without saving it, by embedding one fixed sentence that contains no user content. A passing test SHALL report the vector size. A failing test SHALL report the reason with any key removed.

#### Scenario: A passing test

- **WHEN** the user tests Ollama with model `qwen3-embedding:0.6b`
- **THEN** the result SHALL pass and report 1024 dimensions

#### Scenario: A model the server does not have

- **WHEN** the user tests a model name that the server does not know
- **THEN** the result SHALL fail with the server's error and no key

### Requirement: Stored vectors must match the embedder model and size

OMMS SHALL treat a project's stored vectors as out of date when their recorded model name or vector size differs from the configured embedder. It SHALL report such projects as needing a re-embed.

#### Scenario: Same size, different model

- **WHEN** vectors were made by `qwen3-embedding:0.6b` at 1024 dimensions and the embedder becomes another 1024-dimension model
- **THEN** OMMS SHALL report that a re-embed is needed

### Requirement: A saved embedder change re-embeds every memory

Applying a new embedder SHALL save it to the global config and start one re-embed of every stored memory from its saved text. Only one re-embed SHALL run at a time. Progress SHALL be readable while it runs. When a re-embed fails, projects already done SHALL keep their new vectors, and a retry SHALL re-embed only the projects still out of date. Captures that arrive during the run SHALL be embedded with the new embedder.

#### Scenario: Applying a change

- **WHEN** the user applies a tested embedder and confirms
- **THEN** the global config SHALL hold the new embedder
- **AND** a re-embed SHALL start and report progress until it completes

#### Scenario: The server stops midway

- **WHEN** the embedding server stops after some projects are done
- **THEN** the run SHALL end as failed with the reason
- **AND** a retry SHALL re-embed only the projects still out of date
