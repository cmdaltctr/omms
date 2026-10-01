# capture-diagnostics Specification

## Purpose

Record how each auto-capture and history-import extraction attempt went, so users and maintainers can see why captures fail and how they succeed. Metadata is always logged without conversation text; full prompts and replies are recorded only when the user opts in.

## Requirements

### Requirement: Every capture attempt writes one diagnostics record

For every extraction attempt made by the capture pipeline, on both the Pi and OpenCode hosts, and for both live capture and history import, the system SHALL write exactly one diagnostics record to the OMMS log after the attempt ends. The record SHALL contain: the host, the source type (live capture or history import), the host session ID, the extraction path (host model or external API), the provider, the model, the stop reason reported by the model when available, the list of reply content block types when available, the prompt size in characters, the reply size in characters, the duration in milliseconds, and the outcome. The outcome SHALL be one of `saved`, `skipped`, or `failed`. A `failed` outcome SHALL also include a reason code. Fields the extraction path cannot observe SHALL be recorded as absent, not guessed.

#### Scenario: A capture is saved

- **WHEN** the model returns a valid summary and the memory is stored
- **THEN** the OMMS log SHALL contain one diagnostics record for the attempt with outcome `saved`

#### Scenario: A capture is skipped

- **WHEN** the model returns a reply with type `skip`
- **THEN** the OMMS log SHALL contain one diagnostics record for the attempt with outcome `skipped`

#### Scenario: A retried unit writes one record per attempt

- **WHEN** a work unit fails once and then succeeds on retry
- **THEN** the OMMS log SHALL contain two diagnostics records, the first with outcome `failed` and the second with outcome `saved`

#### Scenario: Both hosts write the same record shape

- **WHEN** the same kind of attempt runs on Pi and on OpenCode
- **THEN** both records SHALL contain the same set of field names

### Requirement: Diagnostics records never contain conversation text

A diagnostics record in the OMMS log SHALL NOT contain any part of the prompt, the conversation context, the model reply, or error messages that quote the reply. It SHALL contain only identifiers, sizes, durations, codes, and the stop reason and block type names.

#### Scenario: A failed reply contains a secret

- **WHEN** the model reply includes an API key and cannot be parsed
- **THEN** the diagnostics record SHALL contain the reply size and reason code
- **AND** the OMMS log SHALL NOT contain the API key or any other reply text

### Requirement: Failed attempts carry a fixed reason code

A failed attempt SHALL carry exactly one of these reason codes:

- `call-error`: the model call failed or threw before a reply was available.
- `empty-text`: the reply had no text content after reasoning or other non-text blocks were removed.
- `truncated`: the model reported that it stopped because of an output length limit.
- `invalid-json`: the reply had text but no JSON object could be read from it.
- `schema-mismatch`: a JSON object was read but it is not a valid capture summary.
- `persist-error`: the summary was valid but the memory could not be stored.

When more than one code could apply, the system SHALL choose the first matching code in the order listed.

#### Scenario: The reply has only reasoning blocks

- **WHEN** the reply contains a reasoning block and no text block
- **THEN** the attempt SHALL fail with reason `empty-text`
- **AND** the record SHALL list the reasoning block type

#### Scenario: The reply was cut off

- **WHEN** the model reports a length stop reason and the reply text is incomplete JSON
- **THEN** the attempt SHALL fail with reason `truncated`

#### Scenario: The reply is JSON with the wrong shape

- **WHEN** the reply is `{"summary":"","type":"feature"}`
- **THEN** the attempt SHALL fail with reason `schema-mismatch`

### Requirement: Capture tracing is opt-in

The system SHALL provide a `captureTrace` setting that defaults to `false`. When it is `false`, the system SHALL NOT write any prompt or reply text anywhere outside the memory store, except in the capture retry queue. The retry queue SHALL hold cleaned turns for a limited time as its own requirements define, whether tracing is on or off. When it is `true`, the system SHALL append one trace entry per extraction attempt to a daily JSON Lines file in a `traces` directory next to the OMMS log file. A trace entry SHALL contain every field of the diagnostics record plus the system prompt, the user prompt sent to the model, and the raw reply text, or the structured reply when the extraction path returns no raw text.

#### Scenario: Tracing is off by default

- **WHEN** a user has not set `captureTrace`
- **THEN** no trace file SHALL be created

#### Scenario: Tracing is on

- **WHEN** `captureTrace` is `true` in the global config and a capture attempt runs
- **THEN** the day's trace file SHALL contain one entry for that attempt with its prompts, reply, and outcome

#### Scenario: A trace write fails

- **WHEN** the trace file cannot be written
- **THEN** the capture attempt SHALL continue with the same outcome it would have had
- **AND** the OMMS log SHALL record that the trace write failed, without trace content

#### Scenario: Tracing is off and a capture fails

- **WHEN** `captureTrace` is `false` and a live capture fails with a retryable error
- **THEN** no trace file SHALL be created
- **AND** the cleaned turn SHALL be written only to the retry queue

### Requirement: Only the global config can turn tracing on

A project config SHALL be able to set `captureTrace` to `false` to turn tracing off for that project. A project config SHALL NOT be able to turn tracing on. When a project config sets `captureTrace` to `true`, the system SHALL ignore that value and log that it was ignored.

#### Scenario: A cloned repository tries to turn tracing on

- **WHEN** the global config does not turn on `captureTrace` and a project config sets it to `true`
- **THEN** no trace file SHALL be written for that project
- **AND** the OMMS log SHALL note that the project value was ignored

#### Scenario: One project opts out

- **WHEN** the global config sets `captureTrace` to `true` and a project config sets it to `false`
- **THEN** no trace entries SHALL be written for attempts in that project

### Requirement: Trace content is redacted before it is written

Before a trace entry is written, the system SHALL remove text inside `<private>` tags from every prompt and reply field, using the same rules as memory storage. It SHALL replace the values of configured secrets and strings that match common API key and token formats with a redaction marker. Trace files and the traces directory SHALL be readable only by the current user.

#### Scenario: A prompt contains private text

- **WHEN** the conversation includes `<private>my password</private>`
- **THEN** the trace entry SHALL contain the redaction marker in its place and SHALL NOT contain `my password`

#### Scenario: A reply contains an API key

- **WHEN** the reply contains a string in a known API key format
- **THEN** the trace entry SHALL contain the redaction marker in place of that string

### Requirement: Old trace files are deleted

The system SHALL delete trace files older than `captureTraceRetentionDays`, which defaults to `7`. Deletion SHALL run at least once per day while tracing is on, and at startup even when tracing is off, so turning tracing off does not leave old traces behind.

#### Scenario: A trace file passes the retention limit

- **WHEN** a trace file is older than `captureTraceRetentionDays`
- **THEN** the system SHALL delete it on its next retention run

#### Scenario: Tracing was turned off

- **WHEN** tracing is off and trace files older than the limit exist
- **THEN** the system SHALL delete them at startup

### Requirement: Capture attempt records are stored for querying

In addition to the log record, the system SHALL store each capture attempt's diagnostics fields in the memory store, with no prompt or reply text. Stored records older than `captureAttemptRetentionDays` (default `30`) SHALL be deleted. A failure to store a record SHALL NOT change the capture outcome.

#### Scenario: Records are queryable

- **WHEN** capture attempts have run on both hosts
- **THEN** the stored records SHALL be queryable by host, model, outcome, reason code, and time range

#### Scenario: Old records are removed

- **WHEN** a stored record is older than `captureAttemptRetentionDays`
- **THEN** the system SHALL delete it during its next cleanup run

#### Scenario: The store write fails

- **WHEN** a record cannot be stored
- **THEN** the capture SHALL keep its outcome and the log record SHALL still be written

### Requirement: External API attempts record their model

A capture attempt that uses the external API SHALL record the extraction path as external API, and SHALL record the provider and model that the call used. This SHALL apply to every host, Claude Code included, and to live capture and history import. Records written before this change SHALL stay unchanged.

#### Scenario: A Claude Code capture

- **WHEN** a Claude Code turn is captured with the external API set to provider `openai-chat` and model `glm-5.3`
- **THEN** its diagnostics record SHALL have path external API, provider `openai-chat`, and model `glm-5.3`

#### Scenario: A failed external API call

- **WHEN** the external API call fails with an HTTP error
- **THEN** the diagnostics record SHALL still contain the path, provider, and model
- **AND** it SHALL contain the failure reason code
