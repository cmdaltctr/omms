## ADDED Requirements

### Requirement: Pi retrieves relevant memory before an agent run

The Pi adapter SHALL use the incoming prompt to retrieve bounded relevant memory before the Pi agent starts.

#### Scenario: Incoming prompt has relevant project history

- **WHEN** `before_agent_start` fires with a project prompt
- **THEN** the adapter MUST resolve the shared project identity
- **AND** perform semantic retrieval using the incoming prompt
- **AND** inject only bounded relevant memory/profile context

### Requirement: Pi automatic capture waits for the settled boundary

The Pi adapter SHALL perform normal automatic capture only after Pi reports the run as fully settled.

#### Scenario: Pi retries, compacts, or continues after a low-level run

- **WHEN** `agent_end` occurs but automatic retry, compaction, or queued continuation remains
- **THEN** the adapter MUST NOT finalize automatic capture for that user request
- **AND** capture MUST occur after `agent_settled`

### Requirement: Pi uses shared memory behavior through a host adapter

The Pi extension SHALL expose applicable memory search/add/list/profile/forget behavior through Pi extension surfaces while delegating memory operations to shared services.

#### Scenario: User manually stores a memory from Pi

- **WHEN** the Pi memory surface performs an add operation
- **THEN** the memory MUST use the same project namespace as OpenCode
- **AND** provenance MUST identify the Pi session

### Requirement: Pi provider integration is host-native

The Pi adapter SHALL perform structured memory extraction with Pi-native model resolution and AI APIs without creating a synthetic Pi conversation.

#### Scenario: Pi model is configured for memory extraction

- **WHEN** automatic capture needs structured extraction
- **THEN** the adapter MUST resolve the configured model/credentials through `ctx.modelRegistry`
- **AND** call a supported Pi AI generation API for the pinned Pi release
- **AND** the extraction call MUST NOT appear as a normal user/assistant turn in the Pi session

### Requirement: Pi compaction preserves memory continuity

The Pi adapter SHALL integrate with Pi compaction events without injecting fake user turns.

#### Scenario: Pi compacts a long session

- **WHEN** Pi runs compaction
- **THEN** relevant memory continuity MUST remain available to subsequent turns
- **AND** the adapter MUST NOT create a synthetic visible user prompt solely to restore memory

### Requirement: Pi shutdown releases adapter resources

The Pi adapter SHALL release resources it owns when the Pi session/process shuts down.

#### Scenario: Pi emits session shutdown

- **WHEN** `session_shutdown` fires
- **THEN** the adapter MUST close or release database/web/backend resources it owns without corrupting shared storage
