## MODIFIED Requirements

### Requirement: Extraction tolerates skip replies and reports unparseable ones

Capture extraction SHALL accept a model reply whose type is `skip` even when `summary` or `tags` are missing, and SHALL treat it as a skip. When a reply cannot be parsed into a capture summary, the system SHALL report it through the capture attempt diagnostics record defined by the `capture-diagnostics` capability, with outcome `failed` and a failure reason code. The OMMS log SHALL NOT contain any part of the reply text. Reply text SHALL be written only to the capture trace file, and only when the user has turned on capture tracing.

#### Scenario: The model replies with a bare skip

- **WHEN** the extraction reply is `{"type":"skip"}`
- **THEN** the work unit SHALL be recorded as skipped
- **AND** it SHALL NOT be counted as a failure

#### Scenario: The model replies with prose

- **WHEN** the extraction reply contains no usable JSON
- **THEN** the unit SHALL fail as before
- **AND** the OMMS log SHALL include a diagnostics record with the provider, the model, the reply length, outcome `failed`, and reason `invalid-json`
- **AND** the OMMS log SHALL NOT include any reply text

#### Scenario: Tracing is on when a reply is unparseable

- **WHEN** capture tracing is on and the extraction reply contains no usable JSON
- **THEN** the trace file SHALL contain the redacted reply text for that attempt
- **AND** the OMMS log SHALL still contain no reply text
