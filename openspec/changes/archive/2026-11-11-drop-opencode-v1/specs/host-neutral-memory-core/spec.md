## REMOVED Requirements

### Requirement: OpenCode behavior remains a compatibility surface

**Reason**: OMMS supports OpenCode V2 only (ADR 048). The package no longer has a V1 `server` entry, so no V1 behaviour remains to keep compatible.

**Migration**: Upgrade OpenCode to V2 and list OMMS under `plugins`. The V2 behaviour is described by the requirement "OpenCode v2 reaches the shared memory behaviour through native hooks".

## ADDED Requirements

### Requirement: OpenCode v2 reaches the shared memory behaviour through native hooks

The OpenCode v2 entry SHALL reach the shared memory behaviour through native v2 hooks: per-prompt retrieval, compaction hooks, the event stream and sessionless structured output. OMMS SHALL NOT keep an OpenCode V1 entry or V1-only behaviour.

#### Scenario: OpenCode v2 invokes the memory plugin

- **WHEN** the v2 adapter handles a v2 lifecycle hook or tool call
- **THEN** the request SHALL reach the shared memory behaviour
- **AND** the memory tool's operations and results SHALL match the Pi tool for the same arguments

#### Scenario: No V1 entry

- **WHEN** a host looks for a V1 `server` entry in the package
- **THEN** it SHALL find none
- **AND** no host SHALL add a first-message recent-memory list
