# Spec Delta

## ADDED Requirements

### Requirement: Extraction tolerates skip replies and reports unparseable ones

Capture extraction SHALL accept a model reply whose type is `skip` even when `summary` or `tags` are missing, and SHALL treat it as a skip. When a reply cannot be parsed into a capture summary, the system SHALL log the provider, the model, and the reply length. It SHALL NOT log any part of the reply text, because replies can contain conversation content.

#### Scenario: The model replies with a bare skip

- **WHEN** the extraction reply is `{"type":"skip"}`
- **THEN** the work unit SHALL be recorded as skipped
- **AND** it SHALL NOT be counted as a failure

#### Scenario: The model replies with prose

- **WHEN** the extraction reply contains no usable JSON
- **THEN** the unit SHALL fail as before
- **AND** the log SHALL include the provider, the model, and the reply length, and no reply text

### Requirement: Live capture uses one model rule on both hosts

OpenCode and Pi SHALL choose the model for automatic capture and profile learning in the same order:

1. the host model: `opencodeProvider`/`opencodeModel` on OpenCode, `piProvider`/`piModel` on Pi, where the model value `inherit` means the session's model
2. the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`), when no host model is set
3. the session's own model, when neither is set

When the host model fails and the external API is fully configured, the call SHALL use the external API and the user SHALL be notified. When the external API is only partly configured and no host model is set, automatic capture SHALL be disabled and the missing settings SHALL be reported.

#### Scenario: Nothing is configured

- **WHEN** no host model and no external API settings exist
- **THEN** automatic capture on either host SHALL use the session's model

#### Scenario: The pinned host model fails

- **WHEN** the configured host model call fails and the external API is fully configured
- **THEN** the capture SHALL be retried through the external API
- **AND** a "Using fallback provider" notification SHALL be shown

#### Scenario: The external API is half configured

- **WHEN** `memoryModel` is set but `memoryApiKey` is not, and no host model is set
- **THEN** automatic capture SHALL be disabled and the missing settings SHALL be reported

### Requirement: History import has the same options on both hosts

The OpenCode and Pi history imports SHALL accept one option set, parsed by one shared parser, both in a session and from the terminal. Only the history location flag SHALL differ: `--db` for OpenCode and `--root` for Pi. The default scope SHALL be the current project on both hosts.

#### Scenario: The same flags on both hosts

- **WHEN** the maintainer passes `--dry-run --scope all-projects --since 2026-01-01 --skip-memories` to either import
- **THEN** both imports SHALL apply the same filters and report in the same format

#### Scenario: A bare end date

- **WHEN** `--until 2026-03-31` is given
- **THEN** work units from the whole of 31 March 2026 SHALL be included
