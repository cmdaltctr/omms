## MODIFIED Requirements

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
