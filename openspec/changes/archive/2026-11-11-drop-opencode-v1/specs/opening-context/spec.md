## MODIFIED Requirements

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

- **WHEN** OMMS is installed in OpenCode V1
- **THEN** OpenCode V1 SHALL NOT load OMMS
- **AND** no opening section SHALL be added
