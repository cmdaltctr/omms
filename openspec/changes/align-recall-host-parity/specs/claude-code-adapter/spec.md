## RENAMED Requirements

- FROM: `### Requirement: Memories are injected at session start and per prompt`
- TO: `### Requirement: Memories are injected per prompt and restored after compaction`

## MODIFIED Requirements

### Requirement: Memories are injected per prompt and restored after compaction

On `UserPromptSubmit` the hook SHALL return the shared retrieval section for the prompt, or nothing when no memory matches. On the first prompt of a session it SHALL also return the opening section when `openingContext` is on. On `SessionStart` with source `compact` or `resume`, and only when `compaction.enabled` is on, it SHALL return the session's own memories in the compaction format. With any other source it SHALL return no memories. Every text SHALL be wrapped in the retrieval tag.

#### Scenario: A prompt that matches saved memories

- **WHEN** the user submits a prompt about a topic with saved memories in that project
- **THEN** Claude SHALL receive those memories as added context for that prompt

#### Scenario: A fresh session adds nothing before the first prompt

- **WHEN** a Claude Code session starts with source `startup` in a project with saved memories, whatever `openingContext` says
- **THEN** the `SessionStart` hook SHALL return no added context
- **AND** the hook SHALL still start the web app when none is running

#### Scenario: Clearing the conversation adds nothing

- **WHEN** the user runs `/clear` and `SessionStart` runs with source `clear`
- **THEN** the hook SHALL return no added context

#### Scenario: The first prompt with the opening context off

- **WHEN** `openingContext` is off and the first prompt of a fresh session matches saved memories
- **THEN** Claude SHALL receive only the memories that match that prompt
- **AND** the project's most recent memories SHALL NOT be added unless they match the prompt

#### Scenario: The first prompt with the opening context on

- **WHEN** `openingContext` is on and the first prompt of a fresh session arrives
- **THEN** the answer SHALL hold the prompt's section and then the opening section for `openingContextQuery`

#### Scenario: A session resumes after compaction

- **WHEN** Claude Code compacts the session and `SessionStart` runs with the compaction source
- **THEN** the hook SHALL return the memories captured from that session
- **AND** an unrelated project's memories SHALL NOT be included

#### Scenario: A resumed session

- **WHEN** the user resumes a session and `SessionStart` runs with source `resume`
- **THEN** the hook SHALL return the memories captured from that session, in the compaction format

#### Scenario: Restore turned off

- **WHEN** `compaction.enabled` is `false` and `SessionStart` runs with source `compact` or `resume`
- **THEN** the hook SHALL return no added context

#### Scenario: Injected context is not captured as a memory

- **WHEN** a turn is captured whose prompt carried injected memories
- **THEN** the injected text SHALL NOT appear in the captured summary or in the stored prompt

#### Scenario: Injected context stays within the size limit

- **WHEN** a retrieval section is longer than Claude Code's added-context size limit
- **THEN** the hook SHALL cut it to the limit and keep the closing retrieval tag

### Requirement: Recalled memories show as fold rows in the reply

For each OMMS retrieval section that the hooks add to the main conversation, the plugin SHALL draw one row at the top of the next reply, above the reply text. A row SHALL be drawn only on the first block of a reply, and each section SHALL be shown on one reply only. A reply with no recall SHALL draw unchanged. Other hook context SHALL NOT make a row. The rows SHALL come from the context the hooks already add, SHALL NOT run a second retrieval, and SHALL NOT be sent to Claude.

#### Scenario: A prompt with matching memories

- **WHEN** the user sends "how did we handle om-pi-todo" and OMMS injects 3 memories
- **THEN** the reply SHALL start with `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]`

#### Scenario: Unfolding a row

- **WHEN** the user presses that row
- **THEN** it SHALL list `mode: search`, the query, `limit: 3`, and the three memories with relevance, id and headline
- **AND** pressing it again SHALL fold it

#### Scenario: First reply of a session

- **WHEN** a fresh session starts, `openingContext` is off, and the first prompt's recall matches 2 memories
- **THEN** the first reply SHALL show one row, with `mode=search` and that prompt as the query
- **AND** no row SHALL show `mode=recent`

#### Scenario: A reply with no recall

- **WHEN** no OMMS section was added since the last reply
- **THEN** the reply SHALL draw as Claude Code draws it, with no OMMS row

#### Scenario: A recall shows once

- **WHEN** one recall was shown on a reply and the next reply follows with no new recall
- **THEN** the next reply SHALL show no OMMS row

#### Scenario: Other hook context

- **WHEN** another plugin's hook adds context that holds no OMMS retrieval section
- **THEN** no OMMS row SHALL be drawn for it

## ADDED Requirements

### Requirement: A Claude Code fold row reads like a memory tool call

Collapsed, a row SHALL read `▸ ● memory [mode=<mode>, query="<query>", limit=<count>]`. The mode SHALL be `restore` for a restored-session section, `opening` for the opening section, and `search` for any other section. For `search` the query SHALL be the last prompt before the section, on one line, cut to 60 characters. For `opening` it SHALL be the configured query. It SHALL be left out for `restore` and when no prompt came first. The count SHALL be the number of memories.

#### Scenario: A restored session

- **WHEN** Claude Code compacts the session and OMMS restores 4 of the session's memories
- **THEN** the next reply SHALL start with `▸ ● memory [mode=restore, limit=4]`

#### Scenario: Compaction right after a prompt

- **WHEN** the user sends a prompt, Claude Code compacts before the reply, and OMMS adds a restored section and then the prompt's section
- **THEN** the reply SHALL show one `mode=restore` row with no query and one `mode=search` row with the prompt as the query

#### Scenario: A search section with no prompt before it

- **WHEN** a non-restored section without the opening marker arrives with no prompt since the last reply
- **THEN** the row SHALL read `▸ ● memory [mode=search, limit=<count>]`, with no query

#### Scenario: The opening section

- **WHEN** `openingContext` is on, the query is "project setup", and the first prompt adds 2 prompt memories and 3 opening memories
- **THEN** the first reply SHALL show a `mode=search` row with `limit=2` and then `▸ ● memory [mode=opening, query="project setup", limit=3]`

#### Scenario: The opening marker cannot end early

- **WHEN** the configured query holds `-->` or a double quote
- **THEN** the marker SHALL hold the query without those characters and the row SHALL still read `mode=opening`

### Requirement: Pressing a Claude Code row unfolds it

Pressing a row SHALL unfold it and pressing it again SHALL fold it. Unfolded, the row SHALL list the mode, the query cut to 300 characters when there is one, the count, and each memory with its relevance and id when the section has them, and a headline cut to 140 characters. The headline is the first line under a `## Request` heading, or else the first line. Fold state SHALL last for the Claude Code session only, and SHALL NOT be written to the transcript or sent to Claude.

#### Scenario: A long query

- **WHEN** the user unfolds a `mode=search` row whose prompt is 400 characters long
- **THEN** the unfolded query SHALL be cut to 300 characters

#### Scenario: A restored memory has no relevance

- **WHEN** the user unfolds a `mode=restore` row
- **THEN** each memory SHALL show its id and headline with no relevance

#### Scenario: No fold command

- **WHEN** the user looks for a command to fold the rows in Claude Code
- **THEN** the plugin SHALL offer no `/omms-recall` command, and pressing a row SHALL be the only way to fold or unfold it

#### Scenario: A new session

- **WHEN** the user unfolded a row, then exits Claude Code and starts a new session
- **THEN** no fold state from the earlier session SHALL apply to the new session's rows

### Requirement: The visibleRecall setting gates Claude Code rows

The plugin SHALL draw no recall row when the effective `visibleRecall` value for the session's folder is `false`. The value is `false` when the global configuration or the project configuration sets it to `false`. A project value SHALL NOT turn rows on. The default SHALL be on. A changed value SHALL apply from the next injected section, with no restart. Turning rows off SHALL NOT stop the memories from reaching Claude.

#### Scenario: Turned off globally

- **WHEN** `visibleRecall` is `false` in the global configuration and a prompt recalls 3 memories
- **THEN** Claude SHALL receive the 3 memories
- **AND** the reply SHALL show no OMMS row

#### Scenario: Turned off for a project

- **WHEN** the global value is `true`, the project configuration sets `visibleRecall` to `false`, and a prompt in that project recalls memories
- **THEN** the reply SHALL show no OMMS row

#### Scenario: A project cannot turn rows on

- **WHEN** the global value is `false` and the project configuration sets `visibleRecall` to `true`
- **THEN** the reply SHALL show no OMMS row

#### Scenario: Rows on by default

- **WHEN** no configuration sets `visibleRecall` or `openingContext`
- **THEN** recall rows SHALL be drawn
- **AND** a main-session prompt's added context SHALL be the same as before this setting applied to Claude Code

#### Scenario: Rows off after compaction

- **WHEN** `visibleRecall` is `false` and OMMS restores the session's memories after compaction
- **THEN** Claude SHALL receive the restored memories and the reply SHALL show no OMMS row

#### Scenario: Rows off for the opening section

- **WHEN** `visibleRecall` is `false` and `openingContext` is on
- **THEN** the opening section SHALL carry the rows-off marker and no opening marker, and no row SHALL be drawn for it

#### Scenario: A changed value applies without a restart

- **WHEN** the user sets `visibleRecall` to `false` in the global configuration during a session
- **THEN** the next prompt's recall SHALL show no OMMS row

#### Scenario: The off state stays within the budget

- **WHEN** `visibleRecall` is `false` and the retrieval section fills the retrieval budget
- **THEN** the added context SHALL hold one short marker line that carries no memory text
- **AND** the added context, marker included, SHALL stay within the retrieval budget and Claude Code's added-context size limit

### Requirement: Claude Code subagents get task memories through SubagentStart and draw no rows

The plugin SHALL register a `SubagentStart` hook. When `subagentMemory` is on, it SHALL return the retrieval section for the subagent's task prompt, read from the parent transcript, and nothing when no task prompt is found or no memory matches. Off, it SHALL return nothing. A subagent SHALL get no opening section. Every subagent section SHALL carry the rows-off marker, and no section in a subagent's conversation SHALL make a row. Subagent turns SHALL NOT be captured on their own.

#### Scenario: Claude runs a subagent with subagent memory on

- **WHEN** `subagentMemory` is on and a prompt makes Claude run an Agent tool subagent whose task matches saved memories
- **THEN** the subagent's transcript SHALL hold one OMMS retrieval section for that task
- **AND** the subagent's transcript view SHALL show no OMMS row

#### Scenario: Subagent memory off

- **WHEN** `subagentMemory` is `false` in the global or the project configuration
- **THEN** the `SubagentStart` hook SHALL return no added context

#### Scenario: No task prompt found

- **WHEN** the parent transcript holds no unanswered `Agent` or `Task` tool call for the subagent's type
- **THEN** the hook SHALL return no added context

#### Scenario: A section in a subagent's conversation

- **WHEN** hook context with an OMMS retrieval section is appended to a subagent's conversation
- **THEN** no OMMS row SHALL be drawn for it

#### Scenario: The main reply keeps its row

- **WHEN** the user's prompt recalls 2 memories and the reply runs a subagent
- **THEN** the main reply SHALL show one `mode=search` row with `limit=2`

#### Scenario: Registered hooks

- **WHEN** the plugin is installed
- **THEN** its hook file SHALL register `SessionStart`, `UserPromptSubmit`, `SubagentStart` and `Stop`, and no `SubagentStop` hook
