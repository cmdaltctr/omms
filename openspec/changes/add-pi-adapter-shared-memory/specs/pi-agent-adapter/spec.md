# pi-agent-adapter Specification

## ADDED Requirements

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

The Pi adapter SHALL use a named structured system-prompt section or an equivalent supported pre-agent context surface for retrieved memory.

#### Scenario: Memory context is injected
- **WHEN** the adapter adds retrieved memory at `before_agent_start`
- **THEN** it SHALL NOT create a fake user message
- **AND** it SHOULD NOT replace the complete system prompt when a structured section can express the same context

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

The Pi adapter SHALL use the Pi model/runtime exposed through extension context for extraction and profile-learning model calls.

#### Scenario: A memory extraction request is needed
- **WHEN** automatic Pi capture needs a model
- **THEN** the adapter SHALL resolve an allowed model using Pi context/model-registry APIs
- **AND** it SHALL call the model through Pi's provider-aware model runtime rather than opening a synthetic Pi conversation

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
