## ADDED Requirements

### Requirement: Rerank switch on the page

The settings card SHALL show `memorisationRerank` as a switch labelled **Rerank text recall (experimental)**, with a short description that the reranker reorders text matches and that the setting is experimental. A change SHALL save to the global config and apply to the next recall.

#### Scenario: Turn on

- **WHEN** a reranker URL and model are set and the user turns the switch on
- **THEN** the global config holds `memorisationRerank: true` and the switch stays on after a reload

#### Scenario: Save fails

- **WHEN** the save request fails
- **THEN** the switch returns to its earlier position and the page shows the server's reason

### Requirement: Rerank switch needs a reranker server

The switch SHALL stay visible and disabled while the reranker URL or model is missing. Its tooltip and an accessible description SHALL say in words that the reranker server must be set on the Memory settings page first.

#### Scenario: No reranker server

- **WHEN** no reranker model is set
- **THEN** the switch is disabled and its tooltip names the missing reranker server

## MODIFIED Requirements

### Requirement: Memorisation list

The page SHALL list the memorisations of every project in the active and linked spaces, newest first, whatever folder the web app runs in. Each row SHALL show the ID, the topic or first line, the host, and the creation time. Opening a row SHALL show the full stored text.

#### Scenario: Rows show IDs

- **WHEN** the active space has two memorisations
- **THEN** the page shows two rows, each with its `ms-` ID

#### Scenario: No memorisations

- **WHEN** the active and linked spaces have no memorisations
- **THEN** the page tells the user how to memorise from an agent or the CLI

#### Scenario: Web app started as a login item

- **WHEN** the web app runs in `/` and the active space holds memorisations saved in the `omrs` repository
- **THEN** the page lists them
