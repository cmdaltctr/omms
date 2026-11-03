# opencode-visible-recall Specification

## Purpose

Defines how OMMS makes its OpenCode v2 recalls visible: the server records a structured summary for each recall, and the terminal TUI shows it as a fold row, without changing the model context or the session transcript.

## Requirements

### Requirement: Each OpenCode v2 recall is reported as a structured summary

When the plugin performs a recall for OpenCode v2 and the retrieval yields a non-empty section, the server entrypoint SHALL record a recall summary for that session and serve the recorded summaries for a session over the plugin RPC channel. Recalls that yield no section, retrieval failures, and recalls for a subagent session (a session that has a parent session) SHALL NOT produce a summary.

#### Scenario: A prompt recall produces a summary

- **WHEN** the user sends a prompt and the retrieval yields a section with 3 memories
- **THEN** the recorded summaries for the session SHALL include one entry for that recall

#### Scenario: No recall

- **WHEN** the retrieval yields no section, fails, or serves a subagent
- **THEN** no summary SHALL be recorded for it

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

### Requirement: Headlines name a memory in one line

The headline of a memory entry SHALL be the first line under a `## Request` heading in the memory body, or else the first line of the body, cut to 140 characters.

#### Scenario: A memory with a Request heading

- **WHEN** a memory body reads `## Request` followed by a line, then more text
- **THEN** the headline SHALL be that next line, cut to 140 characters

#### Scenario: A memory without a Request heading

- **WHEN** a memory body has no `## Request` heading
- **THEN** the headline SHALL be the body's first non-empty line, cut to 140 characters

### Requirement: Recall summaries are shown as fold rows in the terminal TUI

When the `tui` entrypoint loads in the OpenCode terminal TUI and visible recall is enabled, each recorded summary for the session in view SHALL be shown as one row styled like a tool call. Pressing a row SHALL unfold it and pressing it again SHALL fold it. When no summary is recorded, or visible recall is disabled, the TUI SHALL draw nothing for OMMS recall.

#### Scenario: A recall row appears

- **WHEN** a summary is recorded for the session in view while visible recall is enabled
- **THEN** the TUI SHALL show one row for it

#### Scenario: Unfolding a row

- **WHEN** the user presses a row
- **THEN** it SHALL unfold, and pressing it again SHALL fold it

#### Scenario: Folding from the keyboard

- **WHEN** the user runs the slash command `/omms-recall`
- **THEN** the rows of the session in view SHALL unfold, or fold when all of them are already open

#### Scenario: Many recalls in one session

- **WHEN** a session holds more than 5 recorded summaries
- **THEN** the TUI SHALL show only the latest 5 rows

#### Scenario: Nothing to show

- **WHEN** no summary is recorded, or visible recall is disabled
- **THEN** the TUI SHALL draw no OMMS recall row

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

### Requirement: Visible recall does not change model context or the transcript

Drawing recall rows SHALL NOT run a second retrieval, SHALL NOT add any message to the session transcript, and SHALL NOT alter the model context the injection path produces. Rows SHALL be shown only on the user's screen. In frontends that do not load the `tui` entrypoint, behaviour SHALL be unchanged from before this capability.

#### Scenario: Injection unchanged

- **WHEN** a recall is shown as a fold row
- **THEN** the retrieval SHALL have run once for that prompt
- **AND** the session transcript SHALL gain no message for the row

#### Scenario: A frontend without the tui entrypoint

- **WHEN** OMMS runs under a frontend that does not load the `tui` entrypoint, such as OpenChamber
- **THEN** recalls SHALL inject into system context exactly as before and nothing new SHALL be drawn

### Requirement: Visible recall can be turned off

A global configuration setting SHALL control whether the `tui` entrypoint draws recall rows, defaulting to on. A project configuration SHALL be able to turn the rows off but not on. When off, summaries MAY still be recorded and served.

#### Scenario: Turned off globally

- **WHEN** the setting is false in the global configuration
- **THEN** the TUI SHALL draw no recall rows

#### Scenario: Turned off for a project

- **WHEN** the setting is false in the project's configuration
- **THEN** the TUI SHALL draw no recall rows in sessions for that project, even when the global setting is on
