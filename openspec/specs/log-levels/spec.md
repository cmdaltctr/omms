# log-levels Specification

## Purpose

Define the levels of the shared OMMS logger, the format of each log line, and the rule for guessing the level of a line written before levels existed, so a reader can tell failures and degraded states from routine records in every host.

## Requirements

### Requirement: Every log line carries a level

The shared logger SHALL write every line with one of three levels: `info`, `warn` or `error`. A call with a message and optional data and no level SHALL write `info`. A call MAY pass `warn` or `error` as a third argument. Each line SHALL have the form `[<timestamp>] <LEVEL> <message>` followed by `: <data as JSON>` when data is present, where `<LEVEL>` is `INFO`, `WARN` or `ERROR`. Session start markers SHALL keep their current form.

#### Scenario: A call without a level

- **WHEN** code calls `log("Capture attempt", { host: "pi" })`
- **THEN** the log file SHALL gain a line `[<timestamp>] INFO Capture attempt: {"host":"pi"}`

#### Scenario: A call with the error level

- **WHEN** code calls `log("addMemory: error", { error: "API embedding failed: 500" }, "error")`
- **THEN** the log file SHALL gain a line that starts with `[<timestamp>] ERROR addMemory: error`

### Requirement: Failures and degraded states use the matching level

A log call that reports an operation that failed SHALL use `error`. A log call that reports a fallback, a skipped unit, a retry, or a feature that is unavailable while OMMS keeps working SHALL use `warn`. Every other log call SHALL use `info`. A level SHALL NOT change the message text or the data that a call writes.

#### Scenario: Embedding start-up fails

- **WHEN** the embedding model fails to initialise
- **THEN** the line `Failed to initialize embedding model` SHALL have the level `ERROR`

#### Scenario: A host falls back to global fetch

- **WHEN** the OpenCode adapter falls back to the global `fetch`
- **THEN** its log line SHALL have the level `WARN`

### Requirement: Older lines get a guessed level

When the log reader meets a line without a level token, it SHALL guess the level from the message text only, before the first `: {` or `: [`, and SHALL NOT read the data. A message that contains `fail`, `error` or `exception`, ignoring case, SHALL read as `error`. A message that contains `warn`, `fallback`, `falling back`, `unavailable`, `skip` or `retry`, ignoring case, SHALL read as `warn`. Any other message SHALL read as `info`. The reader SHALL mark these records as guessed.

#### Scenario: A legacy failure line

- **WHEN** the log has the line `[2026-10-18T18:36:51.802+01:00] Failed to initialize embedding model: {"error":"..."}`
- **THEN** the reader SHALL return a record with level `error` and `guessed` set to true

#### Scenario: A legacy line whose data mentions an error

- **WHEN** the log has the line `[<timestamp>] Capture attempt: {"error":null}`
- **THEN** the reader SHALL return the level `info`
