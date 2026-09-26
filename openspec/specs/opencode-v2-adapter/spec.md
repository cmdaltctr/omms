# opencode-v2-adapter Specification

## Purpose

Defines how omms behaves as a native OpenCode v2 plugin: per-prompt semantic memory retrieval, compaction restore through v2 session hooks, plugin identity, and coexistence with the V1 entrypoint.

## Requirements

### Requirement: OpenCode v2 retrieves relevant memory for every user prompt

When loaded by OpenCode v2 with memory injection enabled, the plugin SHALL run a semantic search of the current project's memory using the text of each user prompt. It SHALL make the bounded results available to every model request in the agent loop for that prompt.

#### Scenario: A later prompt in a session needs a different memory

- **WHEN** a user sends a second or later prompt in an existing OpenCode v2 session
- **AND** project memory contains an entry relevant to that prompt
- **THEN** the relevant entry SHALL be included in the model context for that prompt's requests
- **AND** inclusion SHALL NOT depend on the prompt being the first message of the session

#### Scenario: Retrieval is shared with Pi

- **WHEN** OpenCode v2 and Pi handle the same prompt text for the same project and configuration
- **THEN** both SHALL select the same memories using the same retrieval and formatting rules

#### Scenario: Retrieval runs once per prompt, not once per model step

- **WHEN** one user prompt causes several model requests (for example, tool-call steps)
- **THEN** the memory search SHALL run at most once for that prompt
- **AND** every model request for that prompt SHALL carry the same retrieved section

#### Scenario: No relevant memory

- **WHEN** the search returns no results above the configured threshold
- **THEN** no memory section SHALL be added to the model context

#### Scenario: Injection disabled or memory unconfigured

- **WHEN** `chatMessage.enabled` is false or the memory store is not configured
- **THEN** no search SHALL run and no memory section SHALL be added

#### Scenario: Retrieval fails

- **WHEN** the memory search throws or times out
- **THEN** the prompt SHALL proceed without a memory section
- **AND** the failure SHALL be logged and SHALL NOT fail the user's request

### Requirement: OpenCode v2 memory injection does not impersonate the user

On OpenCode v2, retrieved memory SHALL be added as a system-context section delimited by an `omms-retrieval` tag. It SHALL NOT be added as a user message, a synthetic session message, or durable session history.

#### Scenario: Memory context is added

- **WHEN** retrieved memory is added for a prompt
- **THEN** it SHALL appear only in the model request's system context
- **AND** the session transcript SHALL NOT gain a message containing the memory text

### Requirement: OpenCode v2 restores session memories after compaction through v2 hooks

When compaction restore is enabled, the plugin SHALL use OpenCode v2 session hooks to make the compacted session's own captured memories available to that session's requests after compaction. It SHALL NOT send a prompt or synthetic message into the session to do so.

#### Scenario: A session is compacted

- **WHEN** OpenCode v2 compacts a session that has captured memories
- **THEN** subsequent model requests in that session SHALL include a bounded restored-session memory section, limited by `compaction.memoryLimit`
- **AND** no prompt, synthetic message, or queued turn SHALL be added to the session by the plugin

#### Scenario: Compaction restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored-session memory section SHALL be added

#### Scenario: Compaction event arrives on the event stream

- **WHEN** a v2 compaction event is observed on the public event stream
- **THEN** the plugin SHALL NOT also run the V1 post-compaction prompt-injection path for it

### Requirement: OpenCode v2 does not depend on V1 agent configuration

On OpenCode v2, the plugin SHALL NOT register an internal agent or rely on the V1 `config` hook for automatic capture or profile learning. Internal structured-output calls SHALL use v2 sessionless generation, which exposes no tools.

#### Scenario: Automatic capture runs on v2

- **WHEN** automatic capture or profile learning requests structured output on OpenCode v2
- **THEN** the request SHALL be served without creating a user-visible session or agent
- **AND** the model SHALL NOT be offered any tools for that request

### Requirement: The package loads under OpenCode v2 and V1 from one entrypoint

The package's default export SHALL be a valid OpenCode v2 plugin definition with the stable `id` `omms` and a `setup` function. It SHALL also expose the V1 `server` entry for OpenCode V1 releases that support object entrypoints (1.18.29 and later).

#### Scenario: OpenCode v2 loads the package

- **WHEN** OpenCode v2 resolves the `omms` package from `plugins`
- **THEN** it SHALL activate a plugin with `id` `omms`
- **AND** it SHALL register the `memory` tool

#### Scenario: OpenCode V1 loads the package

- **WHEN** OpenCode V1 (1.18.29 or later) resolves the package from `plugin`
- **THEN** it SHALL call `server` and receive the V1 hooks, with V1 behaviour unchanged by this change

#### Scenario: The plugin unloads or reloads

- **WHEN** OpenCode v2 disables, reloads, or shuts down the plugin
- **THEN** the plugin SHALL stop its event subscription and release per-session retrieval state and storage handles

### Requirement: The memory tool is a direct tool on OpenCode v2

On OpenCode v2 the `memory` tool SHALL be registered on the provider's native tool list (not only inside the Code Mode catalog), so the model can see and call it directly as it can on OpenCode V1 and Pi.

#### Scenario: A model request is built

- **WHEN** OpenCode v2 sends a model request in a session where omms is active
- **THEN** the request's tool list SHALL include `memory` as a directly callable tool
