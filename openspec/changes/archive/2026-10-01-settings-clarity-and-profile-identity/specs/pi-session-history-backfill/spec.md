# Spec Delta

## ADDED Requirements

### Requirement: Pi's SDK is found outside Pi

When OMMS cannot load Pi's SDK from its own dependencies, it SHALL load the SDK from where Pi is installed: Pi's managed install for its current version, then the package behind each `pi` command on `PATH`, then the global packages of the running Node. Imports, backfills, and Pi model lists SHALL use the SDK found this way. When no copy is found, OMMS SHALL report the original error.

#### Scenario: Pi backfill from the login web app

- **WHEN** the login web app runs a Pi backfill, OMMS's own folder has no Pi SDK, and Pi's managed install has it
- **THEN** the backfill SHALL read Pi sessions with the managed install's SDK

#### Scenario: Pi is not installed

- **WHEN** no copy of the Pi SDK is found
- **THEN** the Pi backfill SHALL fail with the original "Cannot find package" error
