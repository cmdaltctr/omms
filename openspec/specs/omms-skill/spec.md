# omms-skill Specification

## Purpose

One `omms-memory` agent skill that every host loads, and memory context that tells the agent to search the full store, so agents find earlier fixes and decisions instead of investigating from scratch.

## Requirements

### Requirement: Every host loads the omms-memory skill

OMMS SHALL ship one agent skill named `omms-memory`, and every host SHALL load it with no manual copy: the Claude Code plugin, the Pi package, and the OpenCode plugin (V1 and V2). The user SHALL be able to invoke it by name in each host: `/omms:omms-memory` in Claude Code, `/skill:omms-memory` in Pi, and `/omms-memory` in OpenCode.

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

### Requirement: The skill tells the agent when and how to search

The skill description SHALL name the triggers: before debugging or investigating a problem; when the user refers to earlier work ("we fixed this before", "last time", "remember", "did we"); and before a decision about project conventions. The instructions SHALL say to search the full store before investigating, with several keyword searches when the first finds nothing, and to widen to all projects when the project search finds nothing. They SHALL use the host's `memory` tool when it exists, and the `om-memory-system memory` command otherwise. They SHALL say when to save a memory and SHALL forbid storing secrets.

#### Scenario: A host with the memory tool

- **WHEN** the skill loads in Pi or OpenCode
- **THEN** its instructions SHALL direct searches to the `memory` tool with mode `search`

#### Scenario: A host without the memory tool

- **WHEN** the skill loads in Claude Code
- **THEN** its instructions SHALL direct searches to `om-memory-system memory search`

### Requirement: Injected memory context says it is partial

The memory context that OMMS adds to a session SHALL state that it holds only the closest matches, and SHALL tell the agent to search the full store before it investigates a problem or when the user refers to earlier work. The same text SHALL be used by every host. It SHALL stay short and SHALL still mark the memories as background information, not instructions.

#### Scenario: Context added at session start

- **WHEN** OMMS adds memories to a Pi, OpenCode, or Claude Code session
- **THEN** the context header SHALL say the memories are the closest matches only
- **AND** it SHALL tell the agent to search the full store with the memory tool or the `omms-memory` skill before investigating

### Requirement: The memory tool description asks for a search first

The `memory` tool description in Pi and OpenCode SHALL say to search it before debugging or investigating, because earlier fixes and decisions are stored there.

#### Scenario: Reading the tool list

- **WHEN** the agent reads the `memory` tool description
- **THEN** it SHALL contain the instruction to search before debugging or investigating
