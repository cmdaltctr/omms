# host-neutral-memory-core Specification

## ADDED Requirements

### Requirement: Shared memory operations are host-neutral

The system SHALL expose reusable memory operations without requiring OpenCode or Pi lifecycle types.

The shared operations SHALL cover, where applicable, memory persistence, retrieval, vector search, embeddings, privacy filtering, deduplication, project identity, user profiles, cleanup, portability, and capture/extraction orchestration.

#### Scenario: Pi stores a memory without an OpenCode plugin context
- **WHEN** the Pi adapter submits a valid normalized memory/capture request for a project
- **THEN** the shared core SHALL process it without requiring OpenCode `PluginInput`
- **AND** it SHALL persist to the same configured memory store used by OpenCode

### Requirement: Capture accepts a normalized host-neutral work unit

Automatic capture SHALL accept a normalized work unit that contains visible user, assistant, tool, source-identity, project, session, and provenance data without host SDK objects.

#### Scenario: A host includes hidden reasoning in its native transcript
- **WHEN** the host adapter builds a capture work unit
- **THEN** hidden thinking/reasoning SHALL be excluded before the work unit enters shared extraction
- **AND** the shared pipeline SHALL operate only on the normalized visible content

### Requirement: Provider-specific extraction is behind a narrow port

The shared capture/profile pipeline SHALL depend on a provider-neutral structured-extraction interface rather than directly on OpenCode or Pi model APIs.

#### Scenario: Pi extraction fails
- **WHEN** the Pi provider bridge cannot complete a structured extraction request
- **THEN** automatic capture MAY fail or defer for that work unit
- **AND** local manual memory search, list, add, and delete operations SHALL remain available

### Requirement: Existing OpenCode storage remains compatible

The shared core SHALL preserve compatibility with the current OpenCode memory data and project identity.

#### Scenario: An existing project has memories before the refactor
- **WHEN** OpenCode starts after Phase 1
- **THEN** those memories SHALL remain searchable without mandatory export/re-import
- **AND** their project scope SHALL resolve to the same logical project

### Requirement: omms storage default migrates safely from the opencode-mem layout

From Phase 4 the default shared store SHALL be `~/.omms/data`, established by a one-time migration from `~/.opencode-mem/data`. The existing project tag derivation with the default `opencode` container prefix SHALL remain the on-disk format; the prefix SHALL NOT be rewritten by the migration.

#### Scenario: Pi and OpenCode open the same project
- **WHEN** both adapters resolve the same project directory/repository under equivalent configuration
- **THEN** both SHALL resolve the same project memory namespace
- **AND** neither SHALL create a host-specific shadow namespace solely because the host differs

#### Scenario: A legacy opencode-mem store exists and omms starts for the first time
- **WHEN** `~/.omms/data` does not exist and `~/.opencode-mem/data` does
- **THEN** the system SHALL create a timestamped, checksum-verified backup of the entire legacy directory before copying anything
- **AND** it SHALL copy (never move) the store to `~/.omms/data`, verifying every copied file against its source
- **AND** it SHALL write a migration marker so subsequent runs are no-ops
- **AND** the legacy directory SHALL remain byte-for-byte unchanged

#### Scenario: The backup cannot be created or a copied file fails verification
- **WHEN** backup creation or per-file verification fails
- **THEN** the migration SHALL abort before the new store is used
- **AND** the system SHALL keep resolving storage against the legacy layout
- **AND** the legacy directory SHALL remain untouched

#### Scenario: A fresh install with no legacy store
- **WHEN** neither directory exists
- **THEN** the system SHALL start directly at `~/.omms/data` with no migration artefacts

### Requirement: OpenCode behavior remains a compatibility surface

The Phase 1 refactor SHALL preserve the current OpenCode plugin behavior, including the current v2 compatibility bridge.

#### Scenario: OpenCode v2 invokes the memory plugin after extraction
- **WHEN** `src/v2/adapter.ts` maps a v2 lifecycle/tool call into the existing compatibility surface
- **THEN** the request SHALL continue to reach shared memory behavior
- **AND** the refactor SHALL NOT require replacing the v2 adapter as a prerequisite

### Requirement: Cross-host provenance is backward-compatible

New automatic memories SHALL support host/source provenance in backward-compatible metadata.

#### Scenario: A legacy memory has no host field
- **WHEN** the shared core reads or searches that memory
- **THEN** the memory SHALL remain valid
- **AND** absence of host provenance SHALL NOT make it unreadable

### Requirement: Shared-store multi-process safety is verified

The implementation SHALL verify behavior when OpenCode and Pi access the same store from separate processes.

#### Scenario: Two processes write the same project concurrently
- **WHEN** OpenCode and Pi initialize and persist memories concurrently
- **THEN** shard metadata and memory rows SHALL remain consistent
- **AND** successful writes SHALL remain readable after both processes close and reopen the store

#### Scenario: Existing in-process locking is insufficient
- **WHEN** two-process tests demonstrate a race that cannot be prevented by current libSQL transaction behavior
- **THEN** the implementation SHALL add cross-process coordination around the affected operation
- **AND** it SHALL use the narrowest mechanism that preserves existing data compatibility

### Requirement: The repository remains non-monorepo by default

This change SHALL NOT require restructuring the repository into a monorepo.

#### Scenario: Shared services can be imported by both adapters in one package
- **WHEN** one-package internal boundaries satisfy OpenCode and Pi
- **THEN** implementation SHALL keep that simpler repository shape
- **AND** a package split SHALL require separate evidence and design work

### Requirement: Web/backend services are reusable where practical

The existing memory web backend SHALL remain compatible with the shared store and MAY be started or attached by host adapters through shared lifecycle code.

#### Scenario: OpenCode and Pi are both running
- **WHEN** both are configured to expose the memory web backend
- **THEN** they SHALL use the same memory data
- **AND** existing ownership/takeover behavior SHALL prevent them from creating divergent host-specific stores
