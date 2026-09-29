# auto-backfill Specification

## Purpose

Turn past Pi and OpenCode chats into memories and profile input without a manual command, so a new install or a moved machine fills its memory store from the history already on disk.

## Requirements

### Requirement: Past chats are imported automatically when a host starts

When `autoBackfill` is `true`, which is the default, each host SHALL start a background import of its own chat history after it starts: Pi imports Pi sessions from its default sessions folder, OpenCode imports sessions from its default database, and Claude Code imports transcripts from its default projects folder. For Claude Code, the start SHALL be the first `SessionStart` hook that reaches the web app after the web app started, and the web app SHALL run the backfill. The run SHALL cover every project whose directory can be resolved with the importer's project rules, including the saved directory maps in `importPathMaps`. It SHALL use the shared importer, its ledger, and the live capture pipeline, and it SHALL also record the imported prompts and build the user profile from them. The run SHALL start after a start-up delay and SHALL NOT delay session start, prompt handling, retrieval, or live capture. When `autoBackfill` is `false`, or when the user has paused that host's backfill, no automatic run SHALL start. `autoBackfill` SHALL be read from the global config only.

#### Scenario: A new machine with existing history

- **WHEN** Pi starts with `autoBackfill` on, and the Pi sessions folder holds sessions that were never imported
- **THEN** OMMS SHALL import their exchanges in the background
- **AND** the user profile SHALL be built from the imported prompts

#### Scenario: Automatic backfill is off

- **WHEN** a host starts with `autoBackfill` set to `false`
- **THEN** no automatic import SHALL start and no model call SHALL be made for past chats

#### Scenario: Start-up is not delayed

- **WHEN** a host starts with pending history
- **THEN** the session SHALL become usable without waiting for the backfill
- **AND** retrieval and live capture SHALL keep working while the backfill runs

#### Scenario: A project config sets the switch

- **WHEN** a project config sets `autoBackfill`
- **THEN** the value SHALL be ignored and the global value SHALL apply

#### Scenario: Sessions from a mapped directory

- **WHEN** a saved directory map covers sessions recorded in a deleted worktree
- **THEN** the backfill SHALL import them into the map's target project

#### Scenario: The backfill is paused

- **WHEN** the user has paused Pi's backfill and Pi starts
- **THEN** no Pi backfill SHALL start

#### Scenario: A Claude Code session starts

- **WHEN** `autoBackfill` is on and a Claude Code `SessionStart` hook reaches the web app for the first time since the web app started
- **THEN** the web app SHALL run the Claude Code backfill after the start-up delay
- **AND** a second Claude Code session start SHALL NOT start a second run

### Requirement: Backfill covers history up to a fixed cutoff

The first automatic run for a host on a memory store SHALL record a cutoff time for that host in the store. Every automatic run for that host SHALL import only user turns at or before the cutoff. Turns after the cutoff SHALL be left to live capture. The cutoff SHALL NOT move on later runs.

#### Scenario: A chat continues after the cutoff

- **WHEN** a session has turns before and after the host's cutoff
- **THEN** the backfill SHALL import only the turns at or before the cutoff

#### Scenario: A later start

- **WHEN** the host starts again a week later
- **THEN** the backfill SHALL use the cutoff recorded by the first run

### Requirement: Backfill paces its work and resumes after a restart

The backfill SHALL process one exchange at a time. It SHALL resume where it stopped after a restart, crash, or cancellation, and SHALL NOT process an exchange that the ledger records as imported or skipped. Failed exchanges SHALL be retried on a later run. When several exchanges in a row fail because the model call fails, the run SHALL stop, record the reason, and try again on the next host start.

#### Scenario: The host quits during a backfill

- **WHEN** the host quits after 300 of 1,000 exchanges and starts again
- **THEN** the next run SHALL continue with the remaining exchanges
- **AND** no memory SHALL be stored twice

#### Scenario: Pi closes while a backfill is waiting or running

- **WHEN** Pi shuts down during the start-up delay or between exchanges
- **THEN** the pending run SHALL stop before closing the store
- **AND** a later Pi session in the same process SHALL be able to resume with the original cutoff

#### Scenario: The backfill model is unavailable

- **WHEN** the backfill model's calls fail for several exchanges in a row
- **THEN** the run SHALL stop and record the reason
- **AND** the failed exchanges SHALL be retried on the next host start

### Requirement: Only one backfill per host runs at a time

At most one automatic backfill for a given host SHALL run at a time across all processes that share the memory store. A process that finds a run already active SHALL NOT start another. A run left by a process that no longer exists SHALL NOT block a new run. The claim SHALL use a conditional database write that prevents competing processes from replacing one another's claim. It SHALL hold no database transaction while importing, so other Pi sessions can continue normal memory operations. An automatic run SHALL NOT start while a manual import of the same host runs in the same process.

#### Scenario: Two Pi windows start

- **WHEN** two Pi processes start within seconds of each other
- **THEN** only one SHALL run the Pi backfill

#### Scenario: Two processes race to replace a stale claim

- **WHEN** two Pi processes see the same claim left by a dead process
- **THEN** only one SHALL replace it
- **AND** the other process SHALL NOT remove the new owner's claim

#### Scenario: A second Pi session remains active

- **WHEN** one Pi session runs the backfill and another session saves or searches memory
- **THEN** the second session SHALL continue using the store

#### Scenario: The process running the backfill crashes

- **WHEN** the process that runs the backfill dies and another Pi process starts
- **THEN** the new process SHALL run the backfill

### Requirement: Each host's backfill model is configurable

`opencodeBackfillModel` and `piBackfillModel` SHALL choose the model for each host's automatic backfill. The value `inherit`, which is the default, SHALL use the model that the host's live capture would use under the live-model rule. The value `external` SHALL use the external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`). A `provider/model` value SHALL use that model from the host's signed-in models. When the chosen model cannot be resolved, including an `external` value while the external API is not fully configured, the run SHALL NOT start and the status SHALL say why. The setting SHALL NOT change the model of live capture or of manual imports. The Claude Code backfill SHALL always use the external API and SHALL have no backfill model setting.

#### Scenario: A cheaper model for Pi's backfill

- **WHEN** `piBackfillModel` is `zai/glm-5-turbo` and `piModel` is another model
- **THEN** the Pi backfill SHALL call `zai/glm-5-turbo`
- **AND** Pi's live capture SHALL keep using its own model

#### Scenario: The chosen model is not signed in

- **WHEN** `opencodeBackfillModel` names a provider that OpenCode has not connected
- **THEN** no OpenCode backfill SHALL start
- **AND** the status SHALL say that the model is not available

#### Scenario: Backfill through the external API

- **WHEN** `opencodeBackfillModel` is `external` and the external API is fully configured
- **THEN** the OpenCode backfill SHALL call the external API
- **AND** OpenCode's live capture SHALL keep using its own model rule

#### Scenario: The external API is not configured

- **WHEN** `piBackfillModel` is `external` and `memoryModel` is not set
- **THEN** no Pi backfill SHALL start
- **AND** the status SHALL say that `memoryModel` is missing

#### Scenario: The Claude Code backfill model

- **WHEN** the external API is fully configured and the Claude Code backfill runs
- **THEN** it SHALL call the external API
- **AND** no `claudeBackfillModel` setting SHALL be read

### Requirement: Backfill progress is recorded and visible

Each host's backfill SHALL record its state (not started, running, stopped, done, or failed), counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved, the model used, the cutoff, the last update time, and the last error with secrets removed. The record SHALL live in the memory store and SHALL NOT contain prompts, replies, or other conversation content. The host SHALL show one notice when a run starts with pending work, naming the number of exchanges, the model, and the setting that turns the backfill off, and one notice when the run finishes.

#### Scenario: Checking progress

- **WHEN** a backfill is running
- **THEN** its record SHALL show the counts processed so far and the pending count

#### Scenario: Sessions from deleted directories

- **WHEN** some sessions record directories that no longer exist
- **THEN** the backfill SHALL skip them and the record SHALL show how many were skipped for that reason

### Requirement: Imports skip exchanges that live capture already saved

Every history import, automatic or manual, from any surface, SHALL skip an exchange whose user message or entry is already part of a memory that live capture saved for the same host session. It SHALL match Pi user entry IDs against `promptId` and `sourceEntryIds` in existing live memories, and OpenCode user message IDs against the same fields. It SHALL record such an exchange as skipped in the ledger and SHALL count it in the report.

#### Scenario: A chat captured live is backfilled

- **WHEN** live capture saved a memory for a Pi exchange, and the backfill later reaches the same exchange
- **THEN** the backfill SHALL NOT store a second memory for it

#### Scenario: Live capture saves a later turn during an import

- **WHEN** live capture saves a later exchange after the importer has begun that session
- **THEN** the importer SHALL check the live-capture IDs again before that exchange
- **AND** it SHALL report the exchange as skipped without calling the import model

#### Scenario: A manual import after live capture

- **WHEN** the user runs `/memory-import-opencode-history` over a session whose exchanges live capture already saved
- **THEN** those exchanges SHALL be reported as skipped and no duplicate memories SHALL be stored
