# Spec Delta

## Purpose

Defines the Claude Code host: a plugin of shell hooks and a skill that retrieves, captures, and manages shared memories through the OMMS web app, with no in-process plugin API and no MCP server.

## ADDED Requirements

### Requirement: Claude Code integrates through hooks and a terminal command

The Claude Code integration SHALL be a Claude Code plugin made of hook definitions and one skill. Every hook SHALL run the installed `om-memory-system` command with the `claude-hook <event>` subcommand. The plugin SHALL NOT register an MCP server, SHALL NOT write to `CLAUDE.md`, and SHALL NOT read Claude Code's own model or login. The repository SHALL hold the plugin manifest, the hook file, a marketplace file that points at the repository, and the skill, and the documentation SHALL show the same hook entries for users who add them to their Claude Code settings by hand.

#### Scenario: Installing the plugin

- **WHEN** the user adds the OMMS marketplace and installs the plugin in Claude Code, with `om-memory-system` installed globally
- **THEN** the `SessionStart`, `UserPromptSubmit`, and `Stop` hooks SHALL be active in the next Claude Code session
- **AND** no MCP server SHALL be listed for the plugin

#### Scenario: The command is not installed

- **WHEN** a hook runs and `om-memory-system` is not on the `PATH`
- **THEN** Claude Code SHALL continue as if the hook returned nothing

### Requirement: Hooks never block Claude Code

The `claude-hook` command SHALL exit with code 0 on every failure, including a missing or unreadable hook input, an unreachable web app, an HTTP error, and a timeout. It SHALL stop reading standard input after a fixed time limit. `UserPromptSubmit` and `SessionStart` SHALL finish within their hook timeouts and SHALL return no context when the web app does not answer in time. `Stop` SHALL run asynchronously so capture never delays the next prompt. The command SHALL NOT write prompts or replies to its standard error or to the OMMS log.

#### Scenario: The web app is down and cannot start

- **WHEN** `UserPromptSubmit` runs while the web app is not running and the on-demand start fails
- **THEN** the hook SHALL exit with code 0 within its timeout
- **AND** the prompt SHALL reach Claude without added context
- **AND** the OMMS log SHALL record one metadata line with the event name and the failure code

#### Scenario: Standard input never closes

- **WHEN** the hook process receives no end of input
- **THEN** it SHALL stop waiting after the input time limit and exit with code 0

### Requirement: A hook starts the web app on demand

When a hook finds no OMMS web app on the configured port, it SHALL start one as a detached process with the same runtime, port, bind address, and token rules as the login item and `om-memory-system web`. It SHALL then wait for the web app to answer, up to the hook's time budget. The web app SHALL keep running after the Claude Code session ends. When another OMMS process already owns the port, the hook SHALL use it and SHALL NOT start a second server.

#### Scenario: First hook of the day

- **WHEN** `SessionStart` runs and no OMMS web app is running
- **THEN** the hook SHALL start the web app in the background
- **AND** a later `UserPromptSubmit` in the same session SHALL get memories from that web app

#### Scenario: OpenCode already serves the web app

- **WHEN** OpenCode owns the web app port and a Claude Code hook runs
- **THEN** the hook SHALL send its request to that web app and start nothing

### Requirement: Hook endpoints need the API token

The web app SHALL expose one retrieval endpoint and one capture endpoint for the hooks. Both SHALL require the same API token as the other `/api/` routes. The `claude-hook` command SHALL read the token the same way the web app creates it. A request without a valid token SHALL be rejected with the existing unauthorised response.

#### Scenario: A request without the token

- **WHEN** a process posts to the capture endpoint without the token
- **THEN** the web app SHALL reject it and SHALL NOT read the transcript

### Requirement: Memories are injected at session start and per prompt

On `SessionStart` with a fresh session, the hook SHALL return the project's recent memories as added context, in the same format and with the same count as the OpenCode first-message injection. On `SessionStart` after compaction or resume, it SHALL return the memories saved from that session, in the compaction format the other hosts use. On `UserPromptSubmit`, it SHALL return the shared retrieval section for the prompt, or nothing when no memory matches. Every injected text SHALL be wrapped in the shared retrieval tag, SHALL be stripped before capture, and SHALL stay under Claude Code's added-context size limit.

#### Scenario: A prompt that matches saved memories

- **WHEN** the user submits a prompt about a topic with saved memories in that project
- **THEN** Claude SHALL receive those memories as added context for that prompt

#### Scenario: A session resumes after compaction

- **WHEN** Claude Code compacts the session and `SessionStart` runs with the compaction source
- **THEN** the hook SHALL return the memories captured from that session
- **AND** an unrelated project's memories SHALL NOT be included

#### Scenario: Injected context is not captured as a memory

- **WHEN** a turn is captured whose prompt carried injected memories
- **THEN** the injected text SHALL NOT appear in the captured summary or in the stored prompt

### Requirement: Each Claude Code turn is captured through the shared pipeline

On `Stop`, the hook SHALL send the session id, the transcript path, the working directory, and the final assistant text to the capture endpoint. The web app SHALL read only the transcript entries after the last entry it captured for that session, SHALL build one work unit per user prompt from them with the shared transcript reader, and SHALL run each unit through the shared capture pipeline with host `claude-code`, source type `live-capture`, and the transcript entry ids as source entry ids. The endpoint SHALL queue the work and answer at once. It SHALL NOT read entries from sidechains, meta entries, or tool results as user prompts. Text inside `<private>` tags SHALL be removed before any storage. When the transcript is missing or its entries cannot be parsed, the endpoint SHALL log one metadata record and skip the turn, and the hook SHALL still exit with code 0.

#### Scenario: One turn, one memory

- **WHEN** the user asks Claude Code to fix a bug and Claude finishes the turn
- **THEN** the web app SHALL capture that exchange
- **AND** the memory SHALL carry host `claude-code`, the Claude session id, and the project directory

#### Scenario: A turn with several tool calls

- **WHEN** a turn holds many tool uses and tool results before the final text
- **THEN** the work unit SHALL hold the user prompt, the assistant text parts, and the tool calls with their inputs

#### Scenario: The same turn reported twice

- **WHEN** `Stop` fires twice for the same final assistant entry
- **THEN** the second request SHALL capture nothing new

#### Scenario: The transcript file lags behind

- **WHEN** the transcript file does not yet hold the final assistant entry when `Stop` fires
- **THEN** the work unit SHALL use the final assistant text sent by the hook for that turn

#### Scenario: A fully private prompt

- **WHEN** the whole user prompt is inside `<private>` tags
- **THEN** the turn SHALL be skipped and nothing from it SHALL be stored

### Requirement: Claude Code capture uses the external API only

Live capture and profile learning for Claude Code SHALL use the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`). There SHALL be no Claude Code host model setting and no session model path. When the external API is not fully configured, Claude Code capture and profile learning SHALL be off, the missing settings SHALL be reported once per web app start in the log and on the Settings page, and retrieval SHALL keep working.

#### Scenario: The external API is set up

- **WHEN** `memoryModel`, `memoryApiUrl`, and `memoryApiKey` are set and a Claude Code turn ends
- **THEN** the capture SHALL call the external API

#### Scenario: The external API is half configured

- **WHEN** `memoryApiKey` is not set and a Claude Code turn ends
- **THEN** no model call SHALL be made
- **AND** the Settings page SHALL show that Claude Code capture is off and name the missing setting

### Requirement: Failed Claude Code captures use the retry queue

A retryable capture failure for a Claude Code turn SHALL follow the capture retry queue rules for cleaning, size limits, retention, and automatic retries. The web app SHALL run the Claude Code retry drain in the same way it runs the other hosts' drains.

#### Scenario: The external API times out

- **WHEN** the external API does not answer for a Claude Code turn
- **THEN** the cleaned turn SHALL be queued and retried later

### Requirement: Claude Code prompts feed profile learning

The web app SHALL record each captured Claude Code user prompt and SHALL run profile learning on the collected prompts at the same interval the other hosts use, with the external API. A failed profile step SHALL NOT block capture or manual memory operations.

#### Scenario: Enough prompts for a learning pass

- **WHEN** the number of new Claude Code prompts reaches the learning interval
- **THEN** the web app SHALL run one profile learning pass with the external API

### Requirement: Manual memory operations run through a terminal command

`om-memory-system memory <operation> [options]` SHALL run the shared memory operations (search, add, list, forget, and the other modes the `memory` tool offers) against the current project, with host `claude-code`. It SHALL print the same result fields the `memory` tool returns, as JSON. The plugin skill SHALL tell Claude Code when and how to run it. Text inside `<private>` tags SHALL be stripped before storage, as in the tool.

#### Scenario: Claude saves a decision

- **WHEN** Claude Code runs `om-memory-system memory add --content "Use libSQL for the store" --type decision` in a project
- **THEN** the memory SHALL be stored for that project with host `claude-code`

#### Scenario: A search from the terminal

- **WHEN** the user runs `om-memory-system memory search "database choice"` in a project
- **THEN** the command SHALL print the matching memories with their ids and similarity, as JSON

### Requirement: The Claude Code adapter respects the layer boundaries

Code under `src/adapters/claude-code/` SHALL NOT import from the OpenCode or Pi adapters, and `src/core/`, `src/services/`, and `src/importer/` SHALL NOT import from it. The plugin bundle for the other hosts SHALL NOT grow to include the Claude Code hook client.

#### Scenario: The boundary test runs

- **WHEN** the boundary tests run
- **THEN** they SHALL fail on any import that crosses these boundaries
