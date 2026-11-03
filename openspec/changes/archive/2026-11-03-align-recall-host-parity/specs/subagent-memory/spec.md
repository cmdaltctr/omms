## ADDED Requirements

### Requirement: Subagent memory is a setting, on by default

OMMS SHALL offer a global setting `subagentMemory`, default `true`. When it is on, a subagent session SHALL get the memories that match its task prompt, with the same relevance filter, result limit and retrieval budget as a main-session prompt. A project configuration MAY set it to `false` and SHALL NOT turn it on. The setting SHALL control injection only.

#### Scenario: Default on

- **WHEN** no configuration sets `subagentMemory` and a subagent's task matches saved memories
- **THEN** the subagent SHALL receive those memories

#### Scenario: A project turns it off

- **WHEN** the global value is `true` and a project configuration sets `subagentMemory` to `false`
- **THEN** subagents in that project SHALL receive no OMMS memories

#### Scenario: A project cannot turn it on

- **WHEN** the global value is `false` and a project configuration sets `subagentMemory` to `true`
- **THEN** subagents in that project SHALL receive no OMMS memories
- **AND** the log SHALL say the project value was ignored

### Requirement: Subagent sessions draw no rows and keep the capture rules

A subagent session SHALL draw no recall row, whatever `visibleRecall` and `subagentMemory` say. A subagent session SHALL get no opening section. This capability SHALL add no capture path: each host SHALL capture subagent turns only as its existing capture rules already do.

#### Scenario: No rows

- **WHEN** a subagent receives memories on any host
- **THEN** no OMMS row SHALL be drawn for them

#### Scenario: No opening section

- **WHEN** `openingContext` is on and a subagent session sends its first prompt
- **THEN** no opening section SHALL be added

### Requirement: OpenCode V2 gates child-session injection

On OpenCode V2, a session with a parent session is a subagent session. When `subagentMemory` is `false`, the plugin SHALL start no retrieval for such a session. When it is `true`, the plugin SHALL keep the per-prompt recall for it. A failed parent lookup SHALL count as a main session.

#### Scenario: Subagent memory off on OpenCode V2

- **WHEN** `subagentMemory` is `false` and a prompt arrives in a session that has a `parentID`
- **THEN** that session's model requests SHALL carry no OMMS retrieval section

#### Scenario: Subagent memory on on OpenCode V2

- **WHEN** `subagentMemory` is `true` and a child session's prompt matches saved memories
- **THEN** that session's model requests SHALL carry the retrieval section and no row SHALL be recorded

### Requirement: Pi child sessions inject only when OMMS is loaded there

On Pi, a session started with `OMPS_CHILD=1` is a subagent session. When OMMS is loaded in such a session, `before_agent_start` SHALL add the prompt's recall only when `subagentMemory` is on, and SHALL add no opening section and no restored section. A child that does not load OMMS SHALL get nothing from OMMS.

#### Scenario: Child with OMMS loaded and subagent memory off

- **WHEN** OMMS runs in a Pi child with `OMPS_CHILD=1` and `subagentMemory` is `false`
- **THEN** `before_agent_start` SHALL return no OMMS section

#### Scenario: Child with OMMS loaded and subagent memory on

- **WHEN** OMMS runs in a Pi child in RPC mode, `subagentMemory` is on, and the task matches saved memories
- **THEN** `before_agent_start` SHALL return the retrieval section
- **AND** no row SHALL be recorded
