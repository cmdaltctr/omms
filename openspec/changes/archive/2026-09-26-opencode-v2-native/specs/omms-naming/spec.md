# Spec Delta

## Purpose

Makes `omms` the only product name in code, logs, and user-facing surfaces. Defines which legacy `opencode-mem` names stay readable so existing installs keep working.

## ADDED Requirements

### Requirement: omms is the only product name on new surfaces

Log lines, error messages, notifications, web UI branding, tool/agent/session identifiers, exported symbols, export-file metadata, and documentation SHALL use `omms`. They SHALL NOT use `opencode-mem`, except where they refer to a legacy name that is still accepted.

#### Scenario: An error is raised during capture

- **WHEN** a capture, provider, or storage error message is produced
- **THEN** its product prefix SHALL be `omms`

#### Scenario: A memory export is written

- **WHEN** the user exports project memories
- **THEN** the export document SHALL record the producing package as `omms`

#### Scenario: A leftover name is introduced

- **WHEN** source outside the documented legacy-compatibility locations contains `opencode-mem`, `OpenCodeMem`, or `OPENCODE_MEM`
- **THEN** the automated test suite SHALL fail

### Requirement: Legacy names stay readable where users or disk depend on them

Where a name is persisted on disk, written by users, or sent over the wire, the system SHALL use the `omms` name for new writes and lookups. It SHALL continue to accept the legacy `opencode-mem` name as a fallback. When both exist, the `omms` name SHALL take precedence.

#### Scenario: Project config file

- **WHEN** a project contains `.opencode/omms.jsonc` (or `.json`)
- **THEN** it SHALL be used as the project override
- **WHEN** a project contains only `.opencode/opencode-mem.jsonc` (or `.json`)
- **THEN** that legacy file SHALL still be applied as the project override

#### Scenario: Project root marker

- **WHEN** a directory contains `.omms-project` or the legacy `.opencode-mem-project`
- **THEN** it SHALL be treated as a pinned project root, with identical project identity for either marker

#### Scenario: Web API token header

- **WHEN** an API client sends the local auth token or the configured API token
- **THEN** the server SHALL accept it in `x-omms-token`
- **AND** it SHALL still accept the legacy `x-opencode-mem-token` header
- **AND** the bundled web UI SHALL send `x-omms-token`

#### Scenario: Local auth token file

- **WHEN** no token exists at `~/.omms/.auth-token` and a legacy token exists at `~/.opencode-mem/.auth-token`
- **THEN** the legacy token SHALL be adopted into `~/.omms/.auth-token` with user-only permissions
- **AND** the legacy file SHALL remain unchanged

#### Scenario: Internal capture sessions created by an older version

- **WHEN** an internal session titled with the legacy capture title is observed
- **THEN** it SHALL still be recognised as internal and excluded from capture

#### Scenario: Web UI preferences

- **WHEN** the web UI finds no `omms-theme` / `omms-lang` preference but finds the legacy key
- **THEN** it SHALL apply the legacy value and store it under the `omms` key

#### Scenario: Legacy global config, store, and log override

- **WHEN** only `~/.config/opencode/opencode-mem.jsonc`, `~/.opencode-mem/data`, or `OPENCODE_MEM_LOG_FILE` exists
- **THEN** the existing legacy fallbacks and migration SHALL behave as before this change
