## MODIFIED Requirements

### Requirement: The Memory overview shows a Memory injection section below the host cards

`/memory` SHALL show a "Memory injection" section below the host cards and the **Import all hosts** row, with: an "Inject memories at session start" switch noting it adds to the first message of a new session; a 500-character text area for `openingContextQuery`; a "Subagent memory" switch; and a "Restore memories after compaction or resume" switch with its memory limit. It SHALL say the options apply to OpenCode V2, Pi and Claude Code, and which ones a project can turn on.

#### Scenario: Where the section sits

- **WHEN** the user opens `/memory`
- **THEN** the Memory injection section SHALL come after the Pi, OpenCode, Claude Code and Shared cards and after the Import all hosts row
- **AND** the Settings page SHALL show no Memory injection section

#### Scenario: The section shows current values

- **WHEN** the global file sets `openingContext` to `true` and a custom query
- **THEN** the section SHALL show the switch on and the custom query

#### Scenario: The section shows defaults

- **WHEN** the global file sets none of the options
- **THEN** the section SHALL show "Inject memories at session start" off, the query `project architecture, setup, conventions and key decisions`, "Subagent memory" on, and "Restore memories after compaction or resume" on with limit 10

#### Scenario: The host note

- **WHEN** the user reads the section
- **THEN** it SHALL name OpenCode V2, Pi and Claude Code
- **AND** it SHALL NOT mention OpenCode V1

#### Scenario: The project note

- **WHEN** the user reads the section
- **THEN** it SHALL say a project configuration can only turn off the session-start and subagent options, and can turn the restore on or off

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the switches, the text area and the limit field SHALL fit the width
- **AND** the page SHALL NOT scroll horizontally

#### Scenario: Translations

- **WHEN** the user picks Chinese or Arabic
- **THEN** every label, note and message in the section SHALL show in that language
