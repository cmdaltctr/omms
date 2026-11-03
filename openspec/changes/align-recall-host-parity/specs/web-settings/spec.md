## ADDED Requirements

### Requirement: The Memory injection card edits the injection options

The Settings page SHALL show a Memory injection card, listed in the Settings sidebar, with: an "Inject memories at session start" switch noting it adds to the first message of a new session; a 500-character text area for `openingContextQuery`; a "Subagent memory" switch; and a "Restore memories after compaction or resume" switch with its memory limit. The card SHALL say the options apply to OpenCode V2, Pi and Claude Code, and which ones a project can turn on.

#### Scenario: The card shows current values

- **WHEN** the global file sets `openingContext` to `true` and a custom query
- **THEN** the card SHALL show the switch on and the custom query

#### Scenario: The card shows defaults

- **WHEN** the global file sets none of the options
- **THEN** the card SHALL show "Inject memories at session start" off, the default query, "Subagent memory" on, and "Restore memories after compaction or resume" on with limit 10

#### Scenario: The host note

- **WHEN** the user opens the card
- **THEN** it SHALL name OpenCode V2, Pi and Claude Code, and say that OpenCode V1 is not covered

#### Scenario: The project note

- **WHEN** the user opens the card
- **THEN** it SHALL say a project configuration can only turn off the session-start and subagent options, and can turn the restore on or off

#### Scenario: Translations

- **WHEN** the user picks Chinese or Arabic
- **THEN** every label, note and message on the card SHALL show in that language

### Requirement: The Memory injection card saves through the safe config flow

Save SHALL write `openingContext`, `openingContextQuery`, `subagentMemory`, `compaction.enabled` and `compaction.memoryLimit` to the global configuration through the existing config writer. The writer SHALL accept a boolean for each switch, a query whose trimmed length is 0 to 500, and a positive whole number for the limit. It SHALL reject other values with a message that names the key and the rule and does not repeat the value. Reset to default SHALL remove the keys.

#### Scenario: Save a query

- **WHEN** the user types a query of 120 characters and presses Save
- **THEN** the global file SHALL hold the trimmed query
- **AND** the next first prompt SHALL use it, with no restart

#### Scenario: A query that is too long

- **WHEN** a request sends a query of 501 characters
- **THEN** the writer SHALL reject it with "openingContextQuery must be text of 500 characters or fewer"
- **AND** the message SHALL NOT hold any of the submitted text

#### Scenario: A switch value that is not a boolean

- **WHEN** a request sends `subagentMemory` or `compaction.enabled` as the text "yes"
- **THEN** the writer SHALL reject it and leave the file unchanged

#### Scenario: Turn the restore off

- **WHEN** the user turns "Restore memories after compaction or resume" off and presses Save
- **THEN** the global file SHALL hold `compaction.enabled` as `false` and keep `compaction.memoryLimit`
- **AND** no host SHALL restore memories after the next compaction or resume, with no restart

#### Scenario: A restore limit that is not valid

- **WHEN** a request sends `compaction.memoryLimit` as 0, -3, 2.5 or text
- **THEN** the writer SHALL reject it with a message that names the key and the rule and holds none of the submitted value

#### Scenario: Reset to default

- **WHEN** the user presses Reset to default and then Save
- **THEN** the global file SHALL hold none of the card's keys, and the card SHALL show the defaults
