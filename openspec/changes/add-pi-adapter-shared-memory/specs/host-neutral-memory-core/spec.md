## ADDED Requirements

### Requirement: Shared memory services are host-neutral

The memory engine SHALL expose reusable capture, storage, retrieval, project identity, deduplication, privacy, profile, cleanup, portability, and applicable web/backend services without requiring OpenCode or Pi lifecycle types in the shared layer.

#### Scenario: Shared core has no host SDK dependency

- **WHEN** dependency-boundary tests inspect shared core/service modules
- **THEN** they MUST NOT import OpenCode SDK/runtime types
- **AND** they MUST NOT import Pi extension/runtime SDK types
- **AND** host SDK use MUST be confined to adapter modules

### Requirement: Existing OpenCode behavior remains compatible

The refactor SHALL preserve current OpenCode memory retrieval/injection, manual memory operations, automatic capture, profiles, compaction behavior, cleanup, and web/API behavior unless separately specified.

#### Scenario: OpenCode runs after core extraction

- **WHEN** the existing OpenCode integration uses the refactored shared core
- **THEN** its existing supported memory behavior MUST remain functionally compatible

### Requirement: Existing OpenCode storage remains compatible

The change SHALL preserve the default memory data location, shard format, vector semantics, and project/container identity unless a separate migration is explicitly introduced.

#### Scenario: Existing memory directory is opened after upgrade

- **GIVEN** a data directory created before the adapter refactor
- **WHEN** the refactored OpenCode adapter starts
- **THEN** existing memories MUST remain readable and searchable
- **AND** no full re-embedding or namespace migration MUST be required solely because Pi support was added

### Requirement: Both hosts use the same project identity

OpenCode and Pi SHALL resolve project identity through the same shared project-root and tagging logic.

#### Scenario: Both hosts run in the same Git project

- **WHEN** OpenCode and Pi resolve memory scope from equivalent project working directories
- **THEN** they MUST resolve to the same project memory namespace

### Requirement: Host provenance does not partition project retrieval

New memories SHALL support host/source provenance while remaining eligible for normal project retrieval independent of originating host.

#### Scenario: Pi memory is queried from OpenCode

- **GIVEN** Pi captured a memory in project P
- **WHEN** OpenCode searches project P
- **THEN** that memory MUST be eligible for retrieval
- **AND** its provenance MUST identify Pi

#### Scenario: OpenCode memory is queried from Pi

- **GIVEN** OpenCode captured a memory in project P
- **WHEN** Pi searches project P
- **THEN** that memory MUST be eligible for retrieval
