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

### Requirement: OpenCode v2 restores session memories after compaction or resume through v2 hooks

Only when `compaction.enabled` is on, the plugin SHALL use OpenCode v2 session hooks to make a session's own captured memories available to its later requests after compaction, and after resume. A resumed session SHALL be the first prompt this process sees for a session whose history already holds an earlier user prompt. The plugin SHALL NOT send a prompt or synthetic message into the session to do so.

#### Scenario: A session is compacted

- **WHEN** OpenCode v2 compacts a session that has captured memories
- **THEN** subsequent model requests in that session SHALL include a bounded restored-session memory section, limited by `compaction.memoryLimit`
- **AND** no prompt, synthetic message, or queued turn SHALL be added to the session by the plugin

#### Scenario: A session is resumed

- **WHEN** the user opens an earlier OpenCode v2 session that has captured memories and sends a prompt
- **THEN** that prompt's model requests and the later ones SHALL include the restored-session memory section
- **AND** the restored section SHALL be loaded once for that resume

#### Scenario: A new session is not a resume

- **WHEN** the first prompt of a new session arrives
- **THEN** no restored-session memory section SHALL be added

#### Scenario: Compaction restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored-session memory section SHALL be added after compaction or resume

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

### Requirement: OpenCode shows OMMS status in its footer

When OMMS is installed in OpenCode from npm, the OpenCode prompt footer SHALL show `omms: ✔` when the web app answers its health route, and `omms: ✘ web app off` when it does not. Before the first health check answers, the footer SHALL show `omms: ⧖`. If the footer cannot start its status check, it SHALL show `omms: ✘`. Each glyph SHALL be a single-column text symbol, not a colour emoji. The footer SHALL update while OpenCode runs.

#### Scenario: Web app running

- **WHEN** OpenCode starts and the web app answers its health route
- **THEN** the footer SHALL show `omms: ✔`

#### Scenario: Web app stopped

- **WHEN** the web app does not answer its health route
- **THEN** the footer SHALL show `omms: ✘ web app off`

#### Scenario: First check has not answered

- **WHEN** OpenCode starts and the first health check has not answered yet
- **THEN** the footer SHALL show `omms: ⧖`

#### Scenario: The status check cannot start

- **WHEN** the footer fails to load its status check
- **THEN** the footer SHALL show `omms: ✘`

### Requirement: OpenCode tells the user about a newer OMMS release

At start and every 6 hours, OMMS in OpenCode SHALL read the `latest` version of `om-memory-system` from the npm registry. When it is newer than the running version and is not a prerelease, the footer SHALL add `· <version> available`, and OMMS SHALL show one toast that names `opencode plugin update om-memory-system`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** OpenCode runs OMMS 4.2.0 from a local path and npm `latest` is 4.3.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** a toast SHALL name `opencode plugin update om-memory-system`

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

### Requirement: OpenCode says when a background update is installing

When OMMS has started a background update for a newer version, the toast SHALL say that the update is installing instead of naming the update command.

#### Scenario: The background update has started

- **WHEN** OMMS starts the background update for 4.3.0
- **THEN** one toast SHALL say that om-memory-system 4.3.0 is installing in the background

### Requirement: OpenCode installs a newer OMMS release in the background

When OMMS in OpenCode was installed from npm without a pinned version, and the update check finds a newer release that is not a prerelease, OMMS SHALL run `opencode plugin update om-memory-system` in a detached process and SHALL NOT wait for it. OMMS SHALL NOT start a second update for the same release within 30 minutes, across all OpenCode sessions on the computer.

#### Scenario: A release is approved while OpenCode is closed

- **WHEN** OpenCode starts with OMMS 4.2.0 from npm and npm `latest` is 4.3.0
- **THEN** OMMS SHALL start `opencode plugin update om-memory-system` in the background
- **AND** the log SHALL hold an `OpenCode plugin self-update` record with code `started`

#### Scenario: A second session starts soon after

- **WHEN** an update for 4.3.0 started less than 30 minutes ago
- **THEN** a new OpenCode session SHALL NOT start another update

#### Scenario: OMMS runs from a local checkout or a pinned version

- **WHEN** OpenCode loads OMMS from a local path, or the configured package names a version
- **THEN** OMMS SHALL NOT run the update command
- **AND** the footer and toast SHALL behave as in the newer-release requirement

### Requirement: The OpenCode background update is safe and logged

The background update SHALL run apart from memory work. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the update off. A failure SHALL NOT stop memory capture, retrieval, or the `memory` tool. A started or failed start SHALL write one `OpenCode plugin self-update` log record with a code and the two versions.

#### Scenario: The update command cannot start

- **WHEN** the update command cannot be started
- **THEN** memory capture, retrieval and the `memory` tool SHALL keep working
- **AND** the log SHALL hold one `OpenCode plugin self-update` record with code `spawn-failed` and no session content

#### Scenario: Updates are turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT run the update command

### Requirement: OpenCode tells the user to restart after a background update

When a background update installs the newer release, the footer SHALL show `· <version> installed, restart` in place of `· <version> available`, and OMMS SHALL show one toast that says the release is installed and OpenCode must restart to use it. When the update command fails, the footer SHALL keep `· <version> available` and OMMS SHALL show one toast that names `opencode plugin update om-memory-system`.

#### Scenario: The background update succeeds

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 installed, restart`
- **AND** one toast SHALL tell the user to restart OpenCode and run `opencode service restart`

#### Scenario: The background update fails

- **WHEN** the background update for 4.3.0 exits with an error
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one toast SHALL name `opencode plugin update om-memory-system`

### Requirement: The OpenCode restart notice names the background service

OpenCode's background service keeps the old OMMS copy loaded after the TUI restarts. The restart toast SHALL name `opencode service restart`.

#### Scenario: The restart toast names the service command

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the toast SHALL name `opencode service restart`
