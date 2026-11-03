# opening-context Specification

## Purpose

Give the model the stored memories that matter at the start of a session, on every host, when the user turns the opening context on. This capability covers the option, its search query, and when it applies.

## Requirements

### Requirement: The opening context is an option, off by default

OMMS SHALL offer a global setting `openingContext`, default `false`, and a global setting `openingContextQuery`, a search query trimmed and at most 500 characters, default `project architecture, setup, conventions and key decisions`. A project configuration MAY set `openingContext` to `false` and SHALL NOT turn it on. A project `openingContextQuery` SHALL be ignored. Both settings SHALL apply on OpenCode V2, Pi and Claude Code.

#### Scenario: Default off

- **WHEN** no configuration sets `openingContext`
- **THEN** no host SHALL add an opening section

#### Scenario: A project cannot turn it on

- **WHEN** the global value is `false` and a project configuration sets `openingContext` to `true`
- **THEN** no opening section SHALL be added in that project
- **AND** the log SHALL say the project value was ignored, without the configuration text

#### Scenario: A project turns it off

- **WHEN** the global value is `true` and a project configuration sets `openingContext` to `false`
- **THEN** no opening section SHALL be added in that project

#### Scenario: A project query is ignored

- **WHEN** a project configuration sets `openingContextQuery`
- **THEN** the global query SHALL be used

#### Scenario: A hand-edited query is too long

- **WHEN** the global file holds a query of 700 characters
- **THEN** OMMS SHALL use its first 500 characters and log the length, not the text

### Requirement: The opening section travels with the first prompt of a main session

When `openingContext` is on and the query is not empty, OMMS SHALL search memory with the query on the first prompt of a main session and add the matches as a second retrieval section after the prompt's section, in that prompt's model request. It SHALL add nothing before the first prompt. A first prompt SHALL be one whose session history holds no earlier user prompt. A resumed or compacted session and a subagent session SHALL get none.

#### Scenario: First prompt on OpenCode V2

- **WHEN** the option is on and the first prompt of a new OpenCode V2 session arrives
- **THEN** that prompt's model requests SHALL carry the prompt's section and then the opening section

#### Scenario: First prompt on Pi

- **WHEN** the option is on and the first prompt of a new Pi session arrives
- **THEN** `before_agent_start` SHALL return a system prompt with the prompt's section and then the opening section

#### Scenario: First prompt on Claude Code

- **WHEN** the option is on and the first `UserPromptSubmit` of a new Claude Code session arrives
- **THEN** its added context SHALL hold the prompt's section and then the opening section
- **AND** `SessionStart` SHALL have added nothing

#### Scenario: A second prompt

- **WHEN** the option is on and the second prompt of the session arrives
- **THEN** no opening section SHALL be added

#### Scenario: A resumed session after a restart

- **WHEN** the host or web app restarted and the next prompt belongs to a session whose history holds earlier user prompts
- **THEN** no opening section SHALL be added

#### Scenario: Empty query

- **WHEN** the option is on and `openingContextQuery` is empty
- **THEN** no extra search SHALL run

#### Scenario: Retrieval off or private prompt

- **WHEN** per-prompt retrieval is off, or the first prompt is empty or fully private
- **THEN** no opening section SHALL be added

#### Scenario: OpenCode V1

- **WHEN** OMMS runs under OpenCode V1
- **THEN** `openingContext` SHALL have no effect

### Requirement: The opening search uses the per-prompt search rules and budget

The opening search SHALL use the same relevance filter, result limit and current-session rule as the per-prompt recall. It SHALL leave out memories that the prompt's section already holds. The prompt's section SHALL be packed first, and the opening section SHALL use only what is left of the same retrieval budget. A project with no matching memory SHALL add no opening section.

#### Scenario: No match

- **WHEN** no memory in the project matches the query
- **THEN** no opening section SHALL be added

#### Scenario: Duplicate memory

- **WHEN** one memory matches both the prompt and the query
- **THEN** it SHALL appear in the prompt's section only

#### Scenario: Budget full

- **WHEN** the prompt's section fills the retrieval budget
- **THEN** no opening section SHALL be added and the total SHALL stay within the budget

### Requirement: The opening section shows as an opening row

Each host that draws recall rows SHALL draw the opening section as its own row, `▸ ● memory [mode=opening, query="<query>", limit=<count>]`, after the prompt's row, where the query is the configured query cut to 60 characters. The row SHALL honour `visibleRecall`. Drawing it SHALL NOT change what the model receives on OpenCode V2 or Pi.

#### Scenario: Opening row on Pi

- **WHEN** Pi runs in its terminal mode and the first prompt adds an opening section with 3 memories
- **THEN** Pi SHALL draw a `mode=opening` row with `limit=3` after the prompt's row

#### Scenario: Rows off

- **WHEN** `visibleRecall` is `false`
- **THEN** no opening row SHALL be drawn and the opening section SHALL still reach the model
