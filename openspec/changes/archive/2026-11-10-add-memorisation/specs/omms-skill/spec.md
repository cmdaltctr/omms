# Spec Delta

## ADDED Requirements

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
