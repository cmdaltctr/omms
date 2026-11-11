## MODIFIED Requirements

### Requirement: Import runs in a session or from the terminal and never modifies OpenCode data

The plugin SHALL provide a `/memory-import-opencode-history` command in OpenCode, and the package SHALL provide an `import-opencode-history` terminal command. Both SHALL read the OpenCode database read-only and SHALL work while OpenCode is running. Both SHALL read the OpenCode V2 session tables. Neither SHALL write to the OpenCode database or its `-wal` and `-shm` files.

#### Scenario: OpenCode is running during the import

- **WHEN** the maintainer runs the import while OpenCode has the database open
- **THEN** the import SHALL read a consistent snapshot of sessions
- **AND** the OpenCode database and its `-wal` and `-shm` files SHALL be byte-for-byte unchanged afterwards

#### Scenario: Recent turns exist only in the write-ahead log

- **WHEN** a session was written after OpenCode's last checkpoint
- **THEN** the import SHALL include that session

#### Scenario: The database path is not the default

- **WHEN** the maintainer passes `--db <path>`
- **THEN** the command SHALL read that database instead of `~/.local/share/opencode/opencode.db`

### Requirement: Imports are idempotent and recoverable

Each work unit SHALL have a deterministic key built from the session ID, the user message ID and the last answering message ID. A durable ledger in the omms store SHALL record imported, skipped, and failed units. For OpenCode, a unit SHALL count as already handled when the ledger holds an imported or skipped row for the same session ID and user message ID, whatever its last answering message ID is.

#### Scenario: The import is run twice

- **WHEN** the same command runs again over the same database
- **THEN** already imported or skipped units SHALL NOT be processed again
- **AND** no duplicate memories or duplicate profile prompts SHALL be created

#### Scenario: A unit was imported from the V1 tables

- **WHEN** a unit was imported from the V1 tables, and the V2 tables give the same session ID and user message ID with a different last answering message ID
- **THEN** the unit SHALL count as already handled
- **AND** no second memory SHALL be stored for it

#### Scenario: A unit failed earlier

- **WHEN** the command runs again after a model or network failure
- **THEN** failed units SHALL be retried

#### Scenario: The process stops between storing a memory and updating the ledger

- **WHEN** the import is rerun
- **THEN** it SHALL find the stored memory by its import identity and reconcile the ledger instead of storing it again

## ADDED Requirements

### Requirement: The importer reads the OpenCode V2 session tables

The importer SHALL read sessions from `session_v2` and their turns from `session_message`. The existing rules for child sessions, OMMS sessions, project resolution and the `--since` and `--until` filters SHALL apply to these sessions.

#### Scenario: A session exists only in the V2 tables

- **WHEN** a top-level session is in `session_v2` and not in `session`
- **THEN** the import, the dry-run and automatic backfill SHALL list it and build its work units

#### Scenario: OMMS memory context in the session

- **WHEN** a session holds a `synthetic` message that OMMS added
- **THEN** that message SHALL NOT become a prompt, a reply or part of a unit

#### Scenario: A child session in the V2 tables

- **WHEN** a `session_v2` row has a `parent_id`
- **THEN** it SHALL NOT be imported as a separate conversation
- **AND** the dry-run report SHALL count it as folded into its parent

#### Scenario: An OMMS session in the V2 tables

- **WHEN** a `session_v2` row is titled `omms capture` or `opencode-mem capture`
- **THEN** the import SHALL skip it and SHALL NOT count it

### Requirement: The importer reads V1 sessions that V2 does not hold

When the database has the V1 tables, the importer SHALL also read a V1 session whose ID has no row in `session_v2`, with the V1 rules. It SHALL read a session from one table set only. A database with only the V1 tables, such as an older copy passed with `--db`, SHALL import as before.

#### Scenario: OpenCode copied the V1 sessions into V2

- **WHEN** every V1 session ID also has a `session_v2` row
- **THEN** the importer SHALL read each of those sessions from the V2 tables only

#### Scenario: An older V1-only copy

- **WHEN** the maintainer passes `--db` with a database that has no `session_v2` table
- **THEN** the importer SHALL read its sessions from the V1 tables

#### Scenario: A database with neither table set

- **WHEN** the database has neither `session_v2` and `session_message` nor the V1 tables
- **THEN** the import SHALL stop with an error that names the missing tables and SHALL write nothing

### Requirement: V2 messages map to work units

A `user` message SHALL start a work unit with its `text` as the prompt. An `assistant` message SHALL add its `text` content items as replies and its `tool` content items as tool calls with their input and outcome. A `synthetic` or `compaction` message SHALL end the current unit and SHALL NOT be a prompt. The importer SHALL ignore the other message types.

#### Scenario: A prompt with tool calls

- **WHEN** a `user` message is followed by an `assistant` message with a `text` item and a `tool` item whose state is `error`
- **THEN** the unit SHALL hold the prompt, the reply text and one tool call with outcome `error`

#### Scenario: A compaction between two prompts

- **WHEN** a `compaction` message follows an assistant reply
- **THEN** the unit SHALL end at that reply
- **AND** assistant messages after the compaction and before the next `user` message SHALL NOT join that unit

#### Scenario: Other message types

- **WHEN** a session holds `system`, `idle`, `agent-switched`, `model-switched` or `location-switched` messages
- **THEN** they SHALL NOT start, end or join a unit
