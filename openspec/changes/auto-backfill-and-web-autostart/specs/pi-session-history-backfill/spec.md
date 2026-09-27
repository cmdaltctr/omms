# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Backfill is explicit and read-only toward Pi history`
- TO: `### Requirement: Backfill is read-only toward Pi history`

## MODIFIED Requirements

### Requirement: Backfill is read-only toward Pi history

Historical Pi backfill SHALL run when the user requests it, or automatically when `autoBackfill` is on, as the `auto-backfill` capability defines. It SHALL treat Pi session JSONL files as immutable input.

#### Scenario: An import completes successfully

- **WHEN** historical work is imported
- **THEN** the source JSONL file SHALL remain byte-for-byte unchanged

#### Scenario: An import fails partway

- **WHEN** the importer encounters an extraction, storage, or process failure
- **THEN** it SHALL NOT modify, truncate, rename, or delete the source JSONL file

#### Scenario: Automatic backfill is turned off

- **WHEN** `autoBackfill` is `false`
- **THEN** Pi history SHALL be imported only when the user runs an import
