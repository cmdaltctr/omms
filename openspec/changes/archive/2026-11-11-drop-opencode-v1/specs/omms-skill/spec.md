## MODIFIED Requirements

### Requirement: Every host loads the omms-memory skill

OMMS SHALL ship one agent skill named `omms-memory`, and every host SHALL load it with no manual copy: the Claude Code plugin, the Pi package, and the OpenCode V2 plugin. The user SHALL be able to invoke it by name in each host: `/omms:omms-memory` in Claude Code, `/skill:omms-memory` in Pi, and `/omms-memory` in OpenCode.

#### Scenario: Pi session

- **WHEN** a Pi session starts with OMMS installed
- **THEN** the skill list SHALL contain `omms-memory`
- **AND** `/skill:omms-memory` SHALL load its instructions

#### Scenario: OpenCode session

- **WHEN** an OpenCode session starts with the OMMS plugin
- **THEN** the skill list SHALL contain `omms-memory` from the installed package

#### Scenario: Claude Code session

- **WHEN** a Claude Code session starts with the OMMS plugin enabled
- **THEN** the skill list SHALL contain `omms-memory`
