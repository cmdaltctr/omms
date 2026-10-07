## ADDED Requirements

### Requirement: Workflows have their own retention rule

Profile decay SHALL keep a workflow unless both of these are true: it was last seen more than `userProfileWorkflowStaleDays` days ago, and its support is below `userProfileMinEvidenceForRetention`. A workflow's support SHALL be the larger of its evidence count and its frequency. `userProfileWorkflowStaleDays` SHALL default to 30. Preferences and patterns SHALL keep the rule that uses `userProfileStaleDays` and their evidence count.

#### Scenario: A workflow seen once, three days ago

- **WHEN** a workflow has frequency 1, no evidence, and was last seen 3 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL keep the workflow

#### Scenario: A workflow seen once, 31 days ago

- **WHEN** a workflow has frequency 1, no evidence, and was last seen 31 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL remove the workflow

#### Scenario: A repeated workflow, 31 days ago

- **WHEN** a workflow has frequency 3, no evidence, and was last seen 31 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL keep the workflow

#### Scenario: A preference with no evidence, three days ago

- **WHEN** a preference has frequency 5, no evidence, and was last seen 3 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL remove the preference

### Requirement: A forced history import re-analyses profile prompts

When a history import runs with `--force` and without `--skip-profile`, it SHALL also process profile prompts that the ledger records as done. Each such prompt SHALL be recorded as waiting for profile learning, and the run SHALL analyse it with the waiting prompts. A prompt already in the prompt store SHALL be marked as waiting again, and SHALL NOT be stored a second time. Without `--force`, the import SHALL skip profile prompts that the ledger records as done. A dry run with `--force` SHALL count these prompts as prompts it would record, and SHALL make no model calls and no store changes. This SHALL apply to the OpenCode, Pi and Claude Code imports, in the terminal, in every in-session import command, and on the web import page when **force** is on.

#### Scenario: Rebuilding the profile from history

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs `om-memory-system import-pi-history --scope all-projects --force --skip-memories`
- **THEN** the run SHALL send those 1,000 prompts to profile learning in batches
- **AND** it SHALL create no memories

#### Scenario: A rerun without force

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs the same import without `--force`
- **THEN** the run SHALL report 1,000 profile prompts as already done
- **AND** it SHALL send none of them to the model

#### Scenario: A forced dry run

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs the import with `--force --dry-run`
- **THEN** the report SHALL show 1,000 profile prompts it would record
- **AND** the prompt store and the ledger SHALL stay unchanged

#### Scenario: A prompt still in the store

- **WHEN** a forced import reaches a prompt that is still in the prompt store and marked as learned
- **THEN** the prompt SHALL be marked as waiting again
- **AND** the store SHALL still hold one copy of that prompt
