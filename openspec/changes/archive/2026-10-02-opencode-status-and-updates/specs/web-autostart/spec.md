# Spec Delta

## ADDED Requirements

### Requirement: The login item keeps the newest OMMS copy

When OMMS installs or updates the login item, it SHALL point the item at the newest valid OMMS copy among: the copy doing the install, the global install beside the runtime, and the copy the item already runs. A copy is valid when its `package.json` names `om-memory-system` and it has `dist/cli/index.js`. An older copy, such as a host's package cache, SHALL NOT replace a newer one.

#### Scenario: OpenCode starts an older cached copy

- **WHEN** the global install is 4.2.0, the login item runs it, and OpenCode starts OMMS 3.6.2 from its cache
- **THEN** the login item SHALL still run the global 4.2.0 copy

#### Scenario: A newer global install

- **WHEN** the login item runs 4.1.0 and the global install is upgraded to 4.2.0
- **THEN** the next install or host start SHALL point the item at the global 4.2.0 copy
