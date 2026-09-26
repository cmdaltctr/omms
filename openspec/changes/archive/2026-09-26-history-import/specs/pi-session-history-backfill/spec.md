# Spec Delta

## ADDED Requirements

### Requirement: Pi history also feeds the user profile

Unless `--skip-profile` is given, `/memory-import-pi-history` SHALL record each imported user prompt for profile learning, keyed so a rerun never records it twice. It SHALL then build or update the user profile from those prompts in batches, using the same profile analysis as the OpenCode importer.

#### Scenario: Importing Pi history for the first time

- **WHEN** the maintainer imports Pi sessions and no profile exists
- **THEN** a user profile SHALL be created from the imported prompts

#### Scenario: Dry-run with profile steps

- **WHEN** `--dry-run` is given
- **THEN** the report SHALL include the number of profile prompts that would be recorded
- **AND** no prompt or profile data SHALL be written and no model SHALL be called

### Requirement: The Pi import can use a different Pi model

`/memory-import-pi-history` SHALL use the session's current model by default; `piProvider` and `piModel` SHALL NOT change the import model. It SHALL accept `--model <provider/id>`. When given, every extraction and profile call in that import SHALL use that model from Pi's model registry instead.

#### Scenario: A cheaper Pi model for the import

- **WHEN** the maintainer passes `--model zai/glm-5.3-air`
- **THEN** the import SHALL use that model for all calls in that run
- **AND** the active Pi model for normal work SHALL be unchanged

#### Scenario: The model does not exist

- **WHEN** the named model is not in Pi's registry
- **THEN** the command SHALL stop before processing and say that the model was not found

### Requirement: Pi history can also be imported from the terminal

The package SHALL provide an `import-pi-history` terminal command with the same options as the OpenCode import. It SHALL use omms's external model settings or the `--provider`, `--model`, `--api-url`, and `--api-key-env` overrides, as the OpenCode terminal import does.

#### Scenario: Preview from the terminal

- **WHEN** the maintainer runs `om-memory-system import-pi-history --dry-run --root <dir>`
- **THEN** the command SHALL report sessions, work units, and profile prompts
- **AND** it SHALL NOT call a model or write to the store
