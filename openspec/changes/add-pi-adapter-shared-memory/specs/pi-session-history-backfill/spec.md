# pi-session-history-backfill Specification

## ADDED Requirements

### Requirement: Backfill is explicit and read-only toward Pi history

Historical Pi backfill SHALL be opt-in and SHALL treat Pi session JSONL files as immutable input.

#### Scenario: An import completes successfully
- **WHEN** historical work is imported
- **THEN** the source JSONL file SHALL remain byte-for-byte unchanged

#### Scenario: An import fails partway
- **WHEN** the importer encounters an extraction, storage, or process failure
- **THEN** it SHALL NOT modify, truncate, rename, or delete the source JSONL file

### Requirement: Importer prefers Pi's exported session model

The importer SHALL prefer Pi's exported session parsing/session APIs over an independently maintained JSONL parser.

#### Scenario: A known session file is loaded
- **WHEN** the importer opens the session
- **THEN** it SHOULD use `SessionManager.open()` and Pi's public session entry/header model
- **AND** it MAY use `parseSessionEntries()` or `migrateSessionEntries()` where required for supported compatibility or fixtures

### Requirement: Recorded session cwd determines project mapping

The importer SHALL read the session header's recorded `cwd` and resolve project identity through the same shared identity functions used by live capture.

#### Scenario: The JSONL file resides under an encoded session directory
- **WHEN** the header records a valid project cwd
- **THEN** project mapping SHALL use the normalized header cwd/project identity
- **AND** it SHALL NOT depend only on substring parsing of the encoded directory name

### Requirement: Initial backfill uses the active/current branch

The initial importer SHALL prefer the session's active/current branch.

#### Scenario: A historical Pi session contains abandoned branches
- **WHEN** the importer reconstructs work units
- **THEN** entries not on the selected active branch SHALL be excluded from the initial import
- **AND** no memory SHALL be created for an abandoned branch solely because it exists in the JSONL

### Requirement: Importer reconstructs useful work units

The importer SHALL reconstruct candidate user → assistant/tool work units from the selected branch with stable source entry identities.

#### Scenario: A user prompt is followed by assistant text and tool activity
- **WHEN** those entries belong to the active branch
- **THEN** the importer SHALL normalize them into one or more shared capture work units according to the live capture boundary rules
- **AND** provenance SHALL retain the covered source entry IDs

### Requirement: Hidden reasoning is excluded

Historical import SHALL exclude hidden thinking/reasoning and provider-only reasoning metadata from memory extraction input.

#### Scenario: An assistant entry contains visible text and hidden thinking
- **WHEN** the importer normalizes that entry
- **THEN** visible text MAY be included
- **AND** hidden thinking/reasoning SHALL NOT be included in the capture work unit

### Requirement: History uses the live capture pipeline

Historical work units SHALL pass through the same privacy, extraction, deduplication, embedding, and persistence behavior used by live automatic capture.

#### Scenario: Imported content contains private-marked text
- **WHEN** the work unit reaches shared capture
- **THEN** the same privacy policy used by live capture SHALL apply before persistence

#### Scenario: The extractor decides a work unit is non-technical
- **WHEN** the shared extractor returns `skip`
- **THEN** no memory vector SHALL be created for that unit

### Requirement: Imported memories preserve provenance

A memory created from Pi history SHALL preserve enough source provenance to trace it to the original session.

#### Scenario: A historical memory is persisted
- **WHEN** import succeeds
- **THEN** metadata SHALL include `host = "pi"`
- **AND** SHALL include the Pi session ID
- **AND** SHALL include source type `history-import`
- **AND** SHALL include the source JSONL identity/path
- **AND** SHALL include source entry IDs
- **AND** SHOULD include source timestamps when available
- **AND** SHALL include the deterministic import identity

### Requirement: Import identity is deterministic and exact

Each candidate historical work unit SHALL receive a deterministic import identity based on stable Pi session/source-entry identity.

#### Scenario: The same source work unit is discovered twice
- **WHEN** import is rerun without source identity changing
- **THEN** both discoveries SHALL produce the same import identity
- **AND** the importer SHALL NOT rely on vector similarity as the idempotency key

### Requirement: Importer has a durable ledger

The importer SHALL maintain durable state sufficient to distinguish handled and retryable import work.

#### Scenario: A completed import is rerun
- **WHEN** the same deterministic import identity is discovered
- **THEN** the importer SHALL detect the existing terminal state
- **AND** it SHALL not call extraction or persist a duplicate memory

### Requirement: Crash after memory insertion is recoverable

The importer SHALL recover safely if the process stops after a memory has been inserted but before terminal ledger state is recorded.

#### Scenario: Memory exists but ledger completion is missing
- **WHEN** the importer reruns the same source work unit
- **THEN** it SHALL reconcile using the exact stored import identity
- **AND** it SHALL mark/recover the import state without inserting a duplicate memory

### Requirement: Dry-run has no model or storage side effects

Dry-run SHALL report candidate import behavior without performing expensive or mutating import work.

#### Scenario: Dry-run is requested
- **WHEN** the importer scans matching sessions
- **THEN** it MAY read sessions, project identity, existing ledger state, and stored import identities
- **AND** it SHALL NOT call the extraction model
- **AND** it SHALL NOT compute embeddings
- **AND** it SHALL NOT write memories
- **AND** it SHALL NOT write ledger state
- **AND** it SHALL NOT modify Pi session files

### Requirement: Import filters are supported before expensive work

The importer SHALL support current-project, all-projects, exact-session, and date-range filters, and SHALL apply them before extraction/embedding where possible.

#### Scenario: Current-project import is requested
- **WHEN** sessions from multiple projects exist
- **THEN** only sessions resolving to the current shared project identity SHALL become import candidates

#### Scenario: Exact-session import is requested
- **WHEN** an exact Pi session identifier/source is provided
- **THEN** only that matching session SHALL be considered

#### Scenario: Date filtering excludes a work unit
- **WHEN** the unit falls outside the requested inclusive date range under the documented timestamp rule
- **THEN** the importer SHALL skip it before extraction and embedding

### Requirement: Malformed history fails safely

A malformed or unsupported session SHALL not corrupt the shared store or block unrelated valid sessions in an all-projects run.

#### Scenario: One JSONL file cannot be loaded
- **WHEN** all-projects import encounters that file
- **THEN** the importer SHALL report a source-specific error
- **AND** it MAY continue with other independent sessions
- **AND** it SHALL leave the malformed source unchanged
