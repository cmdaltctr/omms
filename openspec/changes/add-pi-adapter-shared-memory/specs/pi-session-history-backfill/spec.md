## ADDED Requirements

### Requirement: Existing Pi sessions can be imported read-only

The system SHALL support explicit import of historical Pi JSONL sessions from a configurable root, defaulting to `~/.pi/agent/sessions`.

#### Scenario: Historical session is discovered

- **WHEN** the importer scans the Pi session root
- **THEN** it MUST parse supported sessions using public Pi-provided session APIs for the pinned Pi version
- **AND** read the recorded `cwd` and session ID
- **AND** MUST NOT modify the source JSONL file

### Requirement: Import does not maintain an independent Pi JSONL parser

The importer SHALL rely on Pi's supported session representation and migration behavior.

#### Scenario: Pi session format requires migration

- **WHEN** a supported older Pi session is imported
- **THEN** migration MUST occur in memory through Pi-supported APIs
- **AND** the source file MUST remain unchanged
- **AND** private Pi source-module imports MUST NOT be required

### Requirement: Historical imports use the normal capture pipeline

Historical Pi work SHALL pass through the same privacy, extraction/classification, deduplication, embedding, and persistence path used for live capture.

#### Scenario: Historical work is transient or non-memory

- **WHEN** the normal capture classifier returns skip
- **THEN** the importer MUST record the source key as handled/skipped
- **AND** MUST NOT create a memory solely because the content came from history

### Requirement: Historical import is idempotent

Each historical work unit SHALL have a deterministic source identity and durable import status.

#### Scenario: Import is rerun

- **GIVEN** a source work unit was previously imported successfully
- **WHEN** the importer processes the same session again
- **THEN** it MUST detect the existing source key
- **AND** create zero additional memories for that work unit

#### Scenario: Crash occurs between memory write and ledger completion

- **GIVEN** a memory with the same deterministic import key already exists
- **WHEN** the next run reconciles the incomplete ledger item
- **THEN** it MUST link/recover the existing memory instead of inserting a duplicate

### Requirement: History import supports a true dry-run

The importer SHALL provide a side-effect-free dry-run.

#### Scenario: User runs dry-run

- **WHEN** history import is invoked with `--dry-run`
- **THEN** it MUST report discovered sessions, project mappings, candidate work units, handled keys, and unreadable files
- **AND** it MUST NOT call extraction models or embedding generation
- **AND** it MUST NOT write memories, vectors, ledger state, or source-session data

### Requirement: History import supports scoped selection

The importer SHALL support current-project, all-projects, session-ID, and date-range selection without changing live project identity rules.

#### Scenario: Current-project import is requested

- **WHEN** the user selects current-project import
- **THEN** only sessions whose recorded `cwd` resolves to the current shared project identity MUST be candidates
- **AND** unrelated Pi projects MUST NOT be imported

### Requirement: Default history import follows the active branch

The initial importer SHALL prefer the session's active/current branch.

#### Scenario: Session contains abandoned branches

- **WHEN** the importer reconstructs work units without an explicit future branch-import option
- **THEN** abandoned branches MUST NOT be imported by default

### Requirement: Hidden reasoning is excluded

Historical normalization SHALL exclude hidden reasoning/thinking content from memory text.

#### Scenario: Session contains hidden thinking

- **WHEN** a work unit is normalized
- **THEN** hidden reasoning/thinking MUST NOT be persisted as memory text

### Requirement: Historical imports preserve provenance

Imported memories SHALL retain enough metadata to audit their origin.

#### Scenario: Imported memory is inspected later

- **WHEN** diagnostics or the web UI expose memory metadata
- **THEN** it MUST be possible to identify `host=pi`, Pi session ID, `history-import` source, source JSONL, original timestamp, and relevant source entry IDs

### Requirement: Source Pi sessions remain immutable

The importer SHALL never modify, delete, rename, truncate, or migrate Pi session JSONL files in place.

#### Scenario: Import completes or fails

- **WHEN** source file hashes are compared before and after the run
- **THEN** every source Pi session file MUST be byte-for-byte unchanged
