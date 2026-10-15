## ADDED Requirements

### Requirement: Pi shows OMMS status in its footer

The Pi adapter SHALL show one OMMS label in Pi's footer while a Pi session with a user interface runs. The label SHALL read `omms: <glyph>`. The glyph SHALL be `⧖` while storage and embeddings start, `✔` when OMMS is ready, `↻` while relevant memories are retrieved, `✎` while settled work is captured, and `✘` when an OMMS operation fails. Each glyph SHALL be a single-column text symbol, not a colour emoji. The adapter SHALL clear the label when the Pi session shuts down. A label for a finished operation SHALL NOT replace the label of a newer one.

#### Scenario: Session starts

- **WHEN** a Pi session starts and storage is warming
- **THEN** the footer SHALL show `omms: ⧖`
- **AND** when warm-up ends, the footer SHALL show `omms: ✔`

#### Scenario: Retrieval runs

- **WHEN** the adapter retrieves memories for a prompt
- **THEN** the footer SHALL show `omms: ↻` until retrieval ends
- **AND** the footer SHALL then show `omms: ✔`

#### Scenario: Capture runs

- **WHEN** the adapter captures a settled work unit
- **THEN** the footer SHALL show `omms: ✎` until capture ends
- **AND** the footer SHALL then show `omms: ✔`

#### Scenario: An operation fails

- **WHEN** warm-up, retrieval, or capture fails
- **THEN** the footer SHALL show `omms: ✘`

#### Scenario: Session shuts down

- **WHEN** `session_shutdown` fires
- **THEN** the footer SHALL show no OMMS label

#### Scenario: Pi has no user interface

- **WHEN** Pi runs without a user interface
- **THEN** the adapter SHALL NOT set a footer label
