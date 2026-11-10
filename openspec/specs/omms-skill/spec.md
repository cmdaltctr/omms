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

The skill description SHALL name the triggers: before debugging or investigating a problem; when the user refers to earlier work ("we fixed this before", "last time", "remember", "did we"); and before a decision about project conventions. The instructions SHALL say to search the full store before investigating, with several keyword searches when the first finds nothing, and to widen to all projects when the project search finds nothing. They SHALL use the host's `memory` tool when it is in the tool list: the `memory` tool in Pi and OpenCode, and `mcp__omms__memory` in Claude Code with the OMMS plugin. They SHALL use the `om-memory-system memory` command only when no `memory` tool is listed. They SHALL say when to save a memory and SHALL forbid storing secrets.

#### Scenario: A host with the memory tool

- **WHEN** the skill loads in Pi or OpenCode
- **THEN** its instructions SHALL direct searches to the `memory` tool with mode `search`

#### Scenario: Claude Code with the OMMS plugin

- **WHEN** the skill loads in Claude Code and `mcp__omms__memory` is in the tool list
- **THEN** its instructions SHALL direct searches to that tool with mode `search`, not to Bash

#### Scenario: A host without the memory tool

- **WHEN** the skill loads in Claude Code with hand-written hooks and no `memory` tool
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

### Requirement: The skill has a section on using OMMS in Claude Code

The `omms-memory` skill SHALL have one section titled "Using OMMS in Claude Code". The section SHALL say:

- Recall arrives as added context, which the user sees as `▸ ● memory [mode=…]` rows at the top of the reply. The context holds the closest matches only.
- Claude should call `mcp__omms__memory`, and should not run the command through Bash, when that tool is listed.
- The tool refuses the `import`, `export`, `migrate` and `list-shards` modes. The user runs those with the `om-memory-system memory` command in a terminal.
- With hand-written hooks or an older plugin, no `memory` tool is listed. Claude then runs `om-memory-system memory` through Bash.
- Each injected memory shows its id, which Claude can pass to `forget` when the user asks to remove that memory.
- Capture runs after each reply in the background. Claude should not save the same turn again unless it holds a decision, a fix, or a preference that the user asked to keep.

The section SHALL stay short, and SHALL hold no Pi or OpenCode instructions.

#### Scenario: Claude Code loads the skill

- **WHEN** Claude Code loads `omms:omms-memory`
- **THEN** the skill text SHALL contain the "Using OMMS in Claude Code" section with the tool name `mcp__omms__memory`, the refused modes, and the Bash fallback

#### Scenario: Pi loads the skill

- **WHEN** Pi loads the skill
- **THEN** the Claude Code section SHALL NOT change which tool Pi uses, because the general instructions still direct Pi to its own `memory` tool

### Requirement: Every host loads the omms-remember skill

OMMS SHALL ship a second agent skill named `omms-remember`, and every host SHALL load it with no manual copy, the same way as `omms-memory`. The user SHALL invoke it as `/omms:omms-remember` in Claude Code, `/skill:omms-remember` in Pi, and `/omms-remember` in OpenCode.

#### Scenario: OpenCode

- **WHEN** the user types `/omms-remember` in OpenCode with the OMMS plugin
- **THEN** the omms-remember skill loads

#### Scenario: Pi

- **WHEN** the user types `/skill:omms-remember` in Pi with the OMMS package
- **THEN** the omms-remember skill loads

### Requirement: omms-remember writes a short snapshot from context

The omms-remember skill SHALL tell the agent to write a session snapshot (topic, done, doing, next) from what it already holds in context, plus cheap read-only state such as the git branch and head commit. It SHALL forbid reading the full session history or transcript files. It SHALL tell the agent to keep the snapshot under the memorisation size cap.

#### Scenario: Agent follows the skill

- **WHEN** the user runs the omms-remember skill mid-session
- **THEN** the agent writes the snapshot without opening session history files

### Requirement: omms-remember saves with memorise and reports the ID

The omms-remember skill SHALL tell the agent to save the snapshot with the `memory` tool in mode `memorise`, or text the user names with `content`, and to tell the user the returned ID. It SHALL use the `om-memory-system memory memorise` command only when no `memory` tool is listed, and SHALL forbid storing secrets.

#### Scenario: Claude Code with the OMMS plugin

- **WHEN** the skill runs in Claude Code and `mcp__omms__memory` is in the tool list
- **THEN** the agent saves through that tool with mode `memorise` and replies with the `ms-` ID

### Requirement: Skills route "what were we going to do" questions to recall

The omms-memory and omms-remember skills SHALL tell the agent to use mode `recall` when the user quotes a memorisation ID or asks what was planned or memorised ("what were we gonna do with", "what did I memorise"), and mode `search` for other questions about earlier work.

#### Scenario: Planned work question

- **WHEN** the user asks "what were we gonna do with the release notes"
- **THEN** the skill directs the agent to call `memory` with mode `recall` and query "release notes"

#### Scenario: Quoted ID

- **WHEN** the user writes "recall ms-4k7q2p"
- **THEN** the skill directs the agent to call `recall` with `ms-4k7q2p`

### Requirement: omms-remember keeps the labels the user names

The omms-remember skill SHALL tell the agent that, when the user names labels, it SHALL pass every one of them in `tags` exactly as written and never drop one. It SHALL also tell the agent to add 1 to 3 labels of its own. The omms-memory and omms-remember skills SHALL tell the agent to recall by label with mode `recall` and `tags`, and SHALL treat "the memorisation labelled X" as that call, not as `search`.

#### Scenario: User names labels

- **WHEN** the user says "memorise this, we should do a, b, c, label it release, wip"
- **THEN** the skill directs the agent to call `memorise` with `tags` that holds `release` and `wip` plus 1 to 3 labels the agent chose

#### Scenario: Recall by label

- **WHEN** the user asks for "the memorisation labelled release"
- **THEN** the skill directs the agent to call `memory` with mode `recall` and `tags` "release"
