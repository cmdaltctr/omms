# capture-retry-queue Specification

## Purpose

Recover live memory captures that failed because the capture model could not be reached, on both OpenCode and Pi, with no user action and with short-lived, cleaned storage of the failed turn.

## Requirements

### Requirement: Failed live captures are classified before they are queued

When a live capture attempt fails on either host, the system SHALL classify the failure as retryable or permanent. Retryable failures SHALL be: a model call that fails with no HTTP status (network failure or timeout), a model call that fails with HTTP status 408, 429 or 5xx, and a failure to write the memory to the local store. All other failures SHALL be permanent, including a model call that fails with any other 4xx status and the reply reasons `empty-text`, `truncated`, `invalid-json` and `schema-mismatch`. The system SHALL queue a turn only after a retryable failure. History imports and profile learning SHALL NOT use the queue.

#### Scenario: The capture API cannot be reached

- **WHEN** a live capture fails because the connection to the model API is refused
- **THEN** the turn SHALL be added to the retry queue

#### Scenario: The API rejects the key

- **WHEN** a live capture fails with HTTP status 401
- **THEN** the turn SHALL NOT be added to the retry queue
- **AND** the diagnostics record SHALL show the failure as today

#### Scenario: The model returns a bad reply

- **WHEN** a live capture fails with reason `invalid-json`
- **THEN** the turn SHALL NOT be added to the retry queue

#### Scenario: Quick retries on both hosts

- **WHEN** a live capture on Pi or OpenCode fails with a retryable error
- **THEN** the host SHALL first try the turn again within the turn, up to `autoCaptureMaxRetries` tries in total (default 3), with waits of 2 seconds and 4 seconds
- **AND** the turn SHALL be queued only if the last quick retry also fails with a retryable error

### Requirement: Queued turns are cleaned and size-limited

Before a turn is written to the queue, the system SHALL remove text inside `<private>` tags and redact secrets with the same rules as the capture trace. A fully private turn SHALL NOT be queued. A turn larger than 256 KB after cleaning SHALL NOT be queued, and the log SHALL record only its size and session ID. The queue SHALL hold at most 20 MB per store; adding a turn that would pass that limit SHALL first delete the oldest queued turns. The queue SHALL be stored in the OMMS data directory and SHALL NOT be written inside a project folder.

#### Scenario: A turn contains private text and a key

- **WHEN** a turn with a `<private>` block and an API key in a tool result is queued
- **THEN** the stored turn SHALL contain neither the private text nor the key

#### Scenario: A turn is too large

- **WHEN** a retryable failure happens for a turn of 300 KB after cleaning
- **THEN** the turn SHALL NOT be queued
- **AND** the log SHALL contain its size and session ID and no conversation text

### Requirement: Queued turns are retried automatically

Each host SHALL retry only the queued turns it created, with its current capture model choice. A host SHALL start a retry pass when a session starts and after a live capture saves a memory. A retry pass SHALL process due turns oldest first, one at a time, and SHALL stop at the first retryable failure. A turn SHALL be due again after waits of 1 minute, 5 minutes, 30 minutes and 2 hours after its first to fourth failed tries, and 12 hours after each later try, each with up to 20 % random extra wait. When the API returns HTTP 429 with a `Retry-After` value, the next try SHALL NOT happen before that time. Two processes SHALL NOT retry the same turn at the same time. Every retry SHALL write one capture diagnostics record.

#### Scenario: The API comes back

- **WHEN** a Pi turn failed while the API was down, and a new Pi session starts after the API is back
- **THEN** the turn SHALL be captured as a memory with the same provenance as a live capture
- **AND** the queued turn SHALL be deleted

#### Scenario: The API is still down

- **WHEN** a retry pass starts with five due turns and the first retry fails with a network error
- **THEN** the pass SHALL stop without trying the other four turns
- **AND** the first turn's next try SHALL be set by the wait schedule

#### Scenario: Two OpenCode windows start together

- **WHEN** two OpenCode processes start a retry pass at the same time
- **THEN** each queued turn SHALL be retried by at most one of them

#### Scenario: A Pi turn is never retried by OpenCode

- **WHEN** a queued turn was created by Pi and an OpenCode session starts
- **THEN** OpenCode SHALL NOT retry that turn

### Requirement: Queued turns are deleted on every final outcome

The system SHALL delete a queued turn when its retry saves a memory, when the extractor decides the turn has nothing worth saving, when a retry fails with a permanent failure, or when the turn is older than `captureRetryRetentionHours`. When an OpenCode retry saves a memory, the OpenCode prompt record SHALL be marked captured and linked to the memory, the same as a live capture. A turn saved by a retry SHALL be skipped by a later history import as already captured.

#### Scenario: A turn expires

- **WHEN** `captureRetryRetentionHours` is 72 and a queued turn is 72 hours and 1 minute old
- **THEN** the turn SHALL be deleted and SHALL NOT be retried

#### Scenario: A retry gets a permanent failure

- **WHEN** a queued turn is retried and the API now returns HTTP 401
- **THEN** the queued turn SHALL be deleted

#### Scenario: Import after a successful retry

- **WHEN** a queued turn was saved by a retry and the user then runs a history import for that session
- **THEN** the import SHALL skip that turn with reason `live-captured`

### Requirement: Retention is a global setting in hours

The system SHALL provide a `captureRetryRetentionHours` setting in the global config. It SHALL default to 72. Values SHALL be rounded down to whole hours and limited to the range 0 to 720. A project config value SHALL be ignored. Running OpenCode and Pi processes SHALL use a changed value from their next retry pass or cleanup run without a restart.

#### Scenario: Default retention

- **WHEN** the user has not set `captureRetryRetentionHours`
- **THEN** queued turns SHALL be deleted after 72 hours

#### Scenario: Out-of-range value

- **WHEN** the global config sets `captureRetryRetentionHours` to 900
- **THEN** the system SHALL use 720

#### Scenario: A project tries to keep turns longer

- **WHEN** a project config sets `captureRetryRetentionHours` to 720 and the global config sets 12
- **THEN** queued turns from that project SHALL be deleted after 12 hours

### Requirement: Zero retention turns the queue off

When `captureRetryRetentionHours` is 0, the system SHALL NOT queue any turn, SHALL NOT retry any turn, and SHALL delete every turn already waiting. A save of 0 on the Settings page SHALL delete waiting turns before the save response returns. A value of 0 set by editing the config file SHALL delete waiting turns at the next retry pass or cleanup run.

#### Scenario: A capture fails while the queue is off

- **WHEN** `captureRetryRetentionHours` is 0 and a live capture fails with a network error
- **THEN** no turn SHALL be queued
- **AND** the diagnostics record SHALL show the failure as today

#### Scenario: The user turns the queue off

- **WHEN** three turns wait in the queue and the user saves 0 on the Settings page
- **THEN** the queue SHALL be empty when the save completes

### Requirement: Queue errors never block memory operations

A failure to write, read, retry or delete queued turns SHALL NOT change the outcome of the live capture that caused it, SHALL NOT block manual `memory` operations, and SHALL be logged with an error code and no conversation text.

#### Scenario: The queue cannot be written

- **WHEN** a retryable capture failure happens and the queue write fails
- **THEN** the live capture SHALL report the same failure it would report without the queue
- **AND** the log SHALL record the queue error code
