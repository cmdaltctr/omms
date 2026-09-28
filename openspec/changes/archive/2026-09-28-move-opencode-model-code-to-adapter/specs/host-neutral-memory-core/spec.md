## MODIFIED Requirements

### Requirement: Provider-specific extraction is behind a narrow port

The shared capture/profile pipeline SHALL depend on a provider-neutral structured-extraction interface rather than directly on OpenCode or Pi model APIs. Shared code in `src/core/`, `src/services/`, `src/types/`, and `src/importer/` SHALL NOT import a host adapter module. Shared code in `src/core/`, `src/services/`, and `src/types/` SHALL NOT import a host SDK (`@opencode-ai/*` or `@earendil-works/*`), statically or dynamically. The importer MAY load a host SDK with dynamic `import()` only in its named modules that read host data without the host running. A host SHALL give shared code its model calls through the `ModelPort` and capture provider ports, or by registering them with the importer. A boundary test SHALL check every shared file for these rules.

#### Scenario: Pi extraction fails

- **WHEN** the Pi provider bridge cannot complete a structured extraction request
- **THEN** automatic capture MAY fail or defer for that work unit
- **AND** local manual memory search, list, add, and delete operations SHALL remain available

#### Scenario: Shared code imports a host SDK

- **WHEN** a file in `src/services/` imports `@opencode-ai/sdk`
- **THEN** the boundary test SHALL fail and name the file

#### Scenario: Profile learning on OpenCode

- **WHEN** OpenCode runs profile learning or AI profile cleanup with an OpenCode host model
- **THEN** the shared profile code SHALL call the model through a `ModelPort` that the OpenCode adapter registers
- **AND** the result SHALL be the same as before the move
