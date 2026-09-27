## ADDED Requirements

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
