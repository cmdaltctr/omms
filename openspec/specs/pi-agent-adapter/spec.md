# pi-agent-adapter Specification

## Purpose

Defines the native Pi extension that retrieves, captures, and manages shared memories through the host-supported Pi runtime.

## Requirements

### Requirement: Pi uses native extension APIs

The Pi integration SHALL be implemented as a Pi extension using current public coding-agent extension APIs.

#### Scenario: The Pi extension loads

- **WHEN** Pi discovers the installed extension
- **THEN** the adapter SHALL register its lifecycle handlers and memory tool through Pi's extension API
- **AND** the shared core SHALL not import Pi lifecycle types

### Requirement: Retrieval occurs before the Pi agent run

The Pi adapter SHALL perform semantic memory retrieval at `before_agent_start`.

#### Scenario: Relevant memory exists for the current prompt

- **WHEN** `before_agent_start` fires for a project prompt
- **THEN** the adapter SHALL search the shared project memory
- **AND** it SHALL make bounded relevant memory available to the agent before the run starts

### Requirement: Memory injection does not impersonate the user

The Pi adapter SHALL add retrieved memory as a named structured system-prompt section delimited by an `omms-retrieval` tag, or through an equivalent supported pre-agent context surface. The section content SHALL be produced by the same shared retrieval used by OpenCode v2.

#### Scenario: Memory context is injected

- **WHEN** the adapter adds retrieved memory at `before_agent_start`
- **THEN** it SHALL NOT create a fake user message
- **AND** it SHOULD NOT replace the complete system prompt when a structured section can express the same context
- **AND** the section SHALL be delimited by `<omms-retrieval>` and `</omms-retrieval>`

### Requirement: Automatic capture uses `agent_settled`

The Pi adapter SHALL use `agent_settled` as the primary automatic-capture boundary.

#### Scenario: Pi finishes a low-level agent run but will retry

- **WHEN** `agent_end` fires and Pi still has an automatic retry, compaction retry, or queued continuation
- **THEN** the adapter SHALL NOT treat that event as the final automatic-capture boundary

#### Scenario: Pi fully settles

- **WHEN** `agent_settled` fires after all automatic continuation has stopped
- **THEN** the adapter SHALL derive the newly completed work unit from the active session branch
- **AND** it SHALL submit that work unit to the shared capture pipeline

### Requirement: Live Pi capture has stable source identity

The adapter SHALL identify the Pi source entries covered by each live captured work unit.

#### Scenario: The same settled state is observed again

- **WHEN** an already handled Pi session/source-entry range is encountered
- **THEN** the adapter SHALL NOT create a duplicate automatic memory for that same source identity

### Requirement: Pi extraction uses Pi's model runtime

The Pi adapter SHALL use the Pi model/runtime exposed through extension context for extraction and profile-learning model calls whenever the live-model rule selects a Pi model: `piProvider`/`piModel` (where `inherit` means the session's model), or the session's model when nothing is configured. When no Pi model is configured and the external API is fully configured, the adapter SHALL use the external API. When a configured Pi model fails or is not in Pi's model registry and the external API is fully configured, the adapter SHALL fall back to the external API.

#### Scenario: A memory extraction request is needed

- **WHEN** automatic Pi capture needs a model
- **THEN** the adapter SHALL resolve an allowed model using Pi context/model-registry APIs
- **AND** it SHALL call the model through Pi's provider-aware model runtime rather than opening a synthetic Pi conversation

#### Scenario: The pinned Pi model is unavailable

- **WHEN** `piProvider`/`piModel` name a model that fails or is not in Pi's registry, and the external API is fully configured
- **THEN** the adapter SHALL use the external API for that call

### Requirement: Pi provides a native memory tool

The Pi adapter SHALL expose a native Pi memory tool backed by shared memory operations.

#### Scenario: A user searches memory from Pi

- **WHEN** the Pi agent calls the memory search operation
- **THEN** the adapter SHALL search the same project memory namespace used by OpenCode
- **AND** results SHALL use the same retrieval semantics as the shared core

### Requirement: Pi records cross-host provenance

Memories captured live from Pi SHALL record source provenance.

#### Scenario: Pi persists a live memory

- **WHEN** shared capture successfully stores the memory
- **THEN** provenance SHALL identify Pi as the host
- **AND** SHALL include the Pi session ID and source entry IDs
- **AND** SHOULD include source timestamps when available

### Requirement: Same-project memories are cross-host retrievable

Pi and OpenCode SHALL share project memory for the same project identity.

#### Scenario: Pi learns a memory and OpenCode opens the project later

- **WHEN** OpenCode searches that project's memory
- **THEN** the Pi-created memory SHALL be eligible for retrieval

#### Scenario: OpenCode learns a memory and Pi opens the project later

- **WHEN** Pi searches that project's memory
- **THEN** the OpenCode-created memory SHALL be eligible for retrieval

### Requirement: Pi compaction does not cause premature or duplicate capture

The Pi adapter SHALL remain compatible with Pi's compaction/retry lifecycle without replacing native compaction by default.

#### Scenario: Context overflow triggers compaction and retry

- **WHEN** Pi compacts and retries before the run settles
- **THEN** automatic memory capture SHALL wait for `agent_settled`
- **AND** the settled work SHALL be captured at most once for its source identity

### Requirement: Pi adapter cleanup uses session shutdown

The Pi adapter SHALL release session-scoped resources in an idempotent `session_shutdown` handler.

#### Scenario: Pi reloads or switches sessions

- **WHEN** `session_shutdown` fires for reload, new, resume, fork, or quit
- **THEN** adapter-owned session resources SHALL be safely released
- **AND** repeated cleanup SHALL not corrupt the shared store

### Requirement: Pi packaging does not bundle a duplicate runtime

The Pi extension SHALL follow current Pi package conventions and treat Pi runtime packages as host-provided peer/runtime dependencies where applicable.

#### Scenario: opencode-mem is installed as a Pi extension package

- **WHEN** Pi loads the extension resource
- **THEN** it SHALL use the host Pi runtime
- **AND** it SHOULD NOT load a second bundled coding-agent runtime solely for the adapter

### Requirement: Pi shows OMMS status in its footer

The Pi adapter SHALL show one OMMS label in Pi's footer while a Pi session with a user interface runs. The label SHALL read `omms: <glyph>`. The glyph SHALL be `⧖` while storage and embeddings start, `✔` when OMMS is ready, `↻` while relevant memories are retrieved, `✎` while settled work is captured, and `✘` when an OMMS operation fails. Each glyph SHALL be a single-column text symbol, not a colour emoji. The adapter SHALL clear the label when the Pi session shuts down. A label for a finished operation SHALL NOT replace the label of a newer one.

#### Scenario: Session starts

- **WHEN** a Pi session starts and storage is warming
- **THEN** the footer SHALL show `omms: ⧖`
- **AND** when warm-up ends, the footer SHALL show `omms: ✔`

#### Scenario: Retrieval runs

- **WHEN** the adapter retrieves memories for a prompt
- **THEN** the footer SHALL show `omms: ↻` until retrieval ends
- **AND** the footer SHALL then show `omms: ✔`

#### Scenario: Capture runs

- **WHEN** the adapter captures a settled work unit
- **THEN** the footer SHALL show `omms: ✎` until capture ends
- **AND** the footer SHALL then show `omms: ✔`

#### Scenario: An operation fails

- **WHEN** warm-up, retrieval, or capture fails
- **THEN** the footer SHALL show `omms: ✘`

#### Scenario: Session shuts down

- **WHEN** `session_shutdown` fires
- **THEN** the footer SHALL show no OMMS label

#### Scenario: Pi has no user interface

- **WHEN** Pi runs without a user interface
- **THEN** the adapter SHALL NOT set a footer label

### Requirement: Pi restores session memories after compaction or resume

When `compaction.enabled` is on, the Pi adapter SHALL load the session's own Pi memories, up to `compaction.memoryLimit`, after `session_compact` and after a resume. A resume is a `session_start` with reason `resume`, or a first prompt in this process for a session whose branch holds earlier user prompts. Each later `before_agent_start` SHALL add the restored section in the shared compaction format until the next compaction or the session ends.

#### Scenario: Pi compacts a session

- **WHEN** Pi compacts a session that has captured memories and the user sends the next prompt
- **THEN** the returned system prompt SHALL hold the prompt's section and then the restored section

#### Scenario: Pi resumes a session

- **WHEN** the user runs `/resume` on a session that has captured memories and sends a prompt
- **THEN** the returned system prompt SHALL hold the restored section

#### Scenario: Pi keeps its own compaction summary

- **WHEN** Pi compacts a session
- **THEN** the adapter SHALL NOT replace or change Pi's compaction summary

#### Scenario: Restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored section SHALL be added

#### Scenario: A restored section within the budget

- **WHEN** the prompt's section and the restored section together exceed the retrieval budget
- **THEN** the restored section SHALL use only what the prompt's section left

#### Scenario: A restore row

- **WHEN** Pi runs in its terminal mode and a restored section with 4 memories is added
- **THEN** Pi SHALL draw `▸ ● memory [mode=restore, limit=4]` once for that restore, when `visibleRecall` is on

#### Scenario: A child session

- **WHEN** OMMS runs in a Pi child session with `OMPS_CHILD=1`
- **THEN** no restored section SHALL be added

### Requirement: Pi installs a newer OMMS release in the background

On `session_start`, when OMMS in Pi was installed from npm without a pinned version, the Pi adapter SHALL read the `latest` version of `om-memory-system` from the npm registry. When it is newer than the running version and is not a prerelease, the adapter SHALL run `pi update npm:om-memory-system` in a detached process and SHALL NOT wait for it. The adapter SHALL NOT start a second update for the same release within 30 minutes, across all Pi sessions on the computer.

#### Scenario: A release is approved while Pi is closed

- **WHEN** a Pi session starts with OMMS 4.2.0 from npm and npm `latest` is 4.3.0
- **THEN** the adapter SHALL start `pi update npm:om-memory-system` in the background
- **AND** the log SHALL hold a `Pi plugin self-update` record with code `started`

#### Scenario: OMMS is current

- **WHEN** the running version and npm `latest` are both 4.3.0
- **THEN** the adapter SHALL NOT run the update command
- **AND** the adapter SHALL show no update notice

#### Scenario: A second session starts soon after

- **WHEN** an update for 4.3.0 started less than 30 minutes ago
- **THEN** a new Pi session SHALL NOT start another update

#### Scenario: OMMS runs from a local checkout or a pinned version

- **WHEN** Pi loads OMMS from a local path, or the configured source names a version
- **THEN** the adapter SHALL NOT run the update command
- **AND** the adapter SHALL show one notification that names `pi update npm:om-memory-system`

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** the adapter SHALL NOT contact the npm registry

### Requirement: The Pi background update is safe and logged

The background update SHALL run apart from memory work. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check and the update off. A failure SHALL NOT delay `session_start` or stop memory capture, retrieval, or the `memory` tool. A started or failed start SHALL write one `Pi plugin self-update` log record with a code and the two versions.

#### Scenario: The update command cannot start

- **WHEN** the update command cannot be started
- **THEN** memory capture, retrieval and the `memory` tool SHALL keep working
- **AND** the log SHALL hold one `Pi plugin self-update` record with code `spawn-failed` and no session content

#### Scenario: Updates are turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT run the update command

### Requirement: Pi tells the user to restart after a background update

While a Pi session with a user interface runs, when a background update installs the newer release, the OMMS footer label SHALL add `· <version> installed, restart`, and the adapter SHALL show one notification that says the release is installed and Pi must restart to use it. When the update command fails, the footer label SHALL add `· <version> available` and the adapter SHALL show one notification that names `pi update npm:om-memory-system`. The suffix SHALL stay when the status glyph changes.

#### Scenario: The background update succeeds

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 installed, restart`
- **AND** one notification SHALL tell the user to restart Pi

#### Scenario: The background update fails

- **WHEN** the background update for 4.3.0 exits with an error
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one notification SHALL name `pi update npm:om-memory-system`

#### Scenario: Retrieval runs after the update

- **WHEN** the footer shows `· 4.3.0 installed, restart` and retrieval starts
- **THEN** the footer SHALL show `omms: ↻ · 4.3.0 installed, restart`

### Requirement: Pi reports an installed update only when the new copy is on disk

When the background update exits with success, the Pi adapter SHALL read the installed OMMS copy before it shows `· <version> installed, restart`. When the installed copy does not hold the new version, the adapter SHALL treat the update as failed: the footer label SHALL add `· <version> available` and one notification SHALL name `pi update npm:om-memory-system`.

#### Scenario: The update command changed nothing

- **WHEN** the background update for 4.3.0 exits with success and the installed copy still holds 4.2.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one notification SHALL name `pi update npm:om-memory-system`
