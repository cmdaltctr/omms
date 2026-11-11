# opencode-history-import Specification

## Purpose

Lets a maintainer rebuild omms memories and the user profile from existing OpenCode session history, from an OpenCode session or the terminal, safely and repeatably.

## Requirements

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

### Requirement: OMMS's own sessions are never imported

Sessions that OMMS created for its own capture, profile, or cleanup model calls SHALL NOT be imported or counted as history.

#### Scenario: Leftover internal sessions exist

- **WHEN** the database contains sessions titled `omms capture` or `opencode-mem capture`
- **THEN** the import SHALL skip them and SHALL NOT count them in the report

### Requirement: Each past exchange becomes a memory through the live capture pipeline

For each user prompt in a top-level session, the importer SHALL build one work unit from that prompt and the assistant and tool work that answers it. Each work unit SHALL go through the same privacy filter, extraction, deduplication, embedding, and persistence as live capture, with provenance `host=opencode` and `sourceType=history-import`. Hidden reasoning and tool outputs SHALL be excluded, and tool inputs SHALL be truncated.

#### Scenario: A technical exchange is imported

- **WHEN** a session contains a prompt that led to code changes
- **THEN** one memory SHALL be stored in that project's memory namespace
- **AND** it SHALL record the OpenCode session ID, the message IDs and the original timestamp as provenance

#### Scenario: A non-technical exchange is imported

- **WHEN** extraction returns `skip`
- **THEN** no memory SHALL be stored
- **AND** the unit SHALL be recorded as skipped so it never costs another model call

### Requirement: Sub-agent sessions are read as part of their parent

Sessions that have a parent session SHALL NOT be imported as separate conversations. Their work SHALL be represented only through the parent session's own record of the delegated task.

#### Scenario: A session spawned sub-agents

- **WHEN** a top-level session delegated work to child sessions
- **THEN** only the top-level session's prompts SHALL produce work units
- **AND** the dry-run report SHALL count child sessions separately as "folded into parent"

### Requirement: Sessions resolve to the project they belong to

Each session SHALL be assigned to a project in this order:

1. its recorded directory, if it exists
2. an explicit `--map <old>=<new>` for that directory
3. OpenCode's recorded project root for the session, if that directory exists

Otherwise the session SHALL be skipped and listed with its directory in the report. The resolved directory SHALL go through the same project identity as live capture.

#### Scenario: A session was recorded in a deleted git worktree

- **WHEN** the recorded directory no longer exists but OpenCode's project root for that session does
- **THEN** the session's memories SHALL be stored in the project root's memory namespace

#### Scenario: Nothing resolves

- **WHEN** neither the directory, a map, nor the project root exists
- **THEN** the session SHALL be skipped
- **AND** the report SHALL list its directory and session count so the maintainer can add a `--map`

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

### Requirement: Dry-run reports cost without side effects

With `--dry-run`, the command SHALL report per project:

- the number of work units to process
- the number already done
- the number of profile prompts
- child sessions folded into their parent
- unresolved directories

It SHALL NOT call any model, compute embeddings, or write memories, ledger state, prompts, or profile data.

#### Scenario: Dry-run before a real import

- **WHEN** the maintainer runs `--dry-run`
- **THEN** the report SHALL show the exact number of model calls a real run would make
- **AND** the omms store SHALL be unchanged

### Requirement: Filters limit work before any model call

The command SHALL support `--scope`, `--project <dir>`, `--since`, `--until`, `--session <id>`, `--max-sessions <n>`, and `--skip-memories` / `--skip-profile`. The default scope SHALL be the current project. Filters SHALL be applied before any model call.

#### Scenario: Importing one project only

- **WHEN** the maintainer passes `--project ~/Development/PROJECTS/omms`
- **THEN** only sessions resolving to that project SHALL be processed

### Requirement: Past prompts feed the user profile

Unless `--skip-profile` is given, the importer SHALL record each past user prompt (not AI replies, not internal omms prompts) for profile learning in the omms store, keyed so a rerun never records it twice. It SHALL then build or update the user profile with omms's profile analysis, in batches, until no unanalysed imported prompts remain.

#### Scenario: A first import with no existing profile

- **WHEN** the import records past prompts and no profile exists
- **THEN** a user profile SHALL be created from them
- **AND** it SHALL appear in the web UI's User Profile tab

#### Scenario: A profile already exists

- **WHEN** the import records past prompts for a maintainer who already has a profile
- **THEN** the existing profile SHALL be updated rather than replaced

### Requirement: The import can use a separate model

In an OpenCode session, the import SHALL use the session's model through OpenCode's sign-in by default. `--model <provider/id>` SHALL select another connected model for the import only. From the terminal, the import SHALL use omms's external model settings, and `--provider`, `--model`, `--api-url`, and `--api-key-env` SHALL override them for the import only. `--api-url` SHALL be required when `--provider` differs from the saved provider. API keys SHALL never be printed or logged.

#### Scenario: A cheaper model in a session

- **WHEN** the maintainer runs `/memory-import-opencode-history --model openrouter/small-model`
- **THEN** every extraction and profile call in that run SHALL use that model
- **AND** the session's model SHALL be unchanged

#### Scenario: A cheaper model from the terminal

- **WHEN** the maintainer passes `--provider openai-chat --model deepseek-v4-flash --api-url https://api.deepseek.com/v1 --api-key-env DEEPSEEK_API_KEY`
- **THEN** every extraction and profile call in that run SHALL use that model
- **AND** omms's saved configuration SHALL be unchanged

#### Scenario: No usable model

- **WHEN** a real run has no session model, no connected `--model`, and no usable external settings
- **THEN** the run SHALL stop before processing and say which setting is missing

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
