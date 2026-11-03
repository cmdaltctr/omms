## MODIFIED Requirements

### Requirement: A recall summary carries the call and its memories

Each summary SHALL carry the mode, the query for a `search` or `opening` recall, and one entry per injected memory. The mode SHALL be `search` for a prompt's recall, `opening` for the opening search with the configured query, and `restore` for a restored-session section, with no query. A host's recent-memory opening recall SHALL use `recent` with no query; OpenCode v2 makes none. Each entry SHALL carry its relevance when known, its id when present, and a headline cut to 140 characters.

#### Scenario: A search summary's fields

- **WHEN** a prompt "how did we handle om-pi-todo" recalls 3 memories
- **THEN** the summary SHALL have `mode=search`, the prompt as the query, and 3 entries each with relevance and headline

#### Scenario: An opening summary's fields

- **WHEN** the opening search with query "project setup" adds 2 memories on the first prompt
- **THEN** the summary SHALL have `mode=opening`, "project setup" as the query, and 2 entries

#### Scenario: A restore summary's fields

- **WHEN** a restored-session section with 4 memories is added after compaction or resume
- **THEN** one summary SHALL have `mode=restore`, no query, and 4 entries without relevance

#### Scenario: A recent summary's fields

- **WHEN** a host's opening recent-memory retrieval for a session yields memories
- **THEN** the summary SHALL have `mode=recent` and no query

#### Scenario: No opening recall on OpenCode v2

- **WHEN** a session opens under OpenCode v2
- **THEN** no `recent` summary SHALL be recorded for it
- **AND** an `opening` summary SHALL be recorded only after the first prompt, when `openingContext` is on

### Requirement: A fold row reads like a memory tool call

Collapsed, a row SHALL read `▸ ● memory [mode=<mode>, query="<query>", limit=<count>]`. The query SHALL be the summary's query on one line cut to 60 characters, and SHALL be left out for `restore` and `recent`. Unfolded, the row SHALL list the mode, the query cut to 300 characters when present, the count, and each memory with its relevance when known, id when present, and headline.

#### Scenario: A collapsed search row

- **WHEN** a summary with `mode=search`, query "how did we handle om-pi-todo" and 3 memories is shown
- **THEN** the collapsed row SHALL read `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]`

#### Scenario: An unfolded row lists the memories

- **WHEN** the user unfolds that row
- **THEN** it SHALL list `mode: search`, the query, `limit: 3`, and the three memories with relevance, id and headline

#### Scenario: A collapsed restore row

- **WHEN** a summary with `mode=restore` and 4 memories is shown
- **THEN** the collapsed row SHALL read `▸ ● memory [mode=restore, limit=4]`
