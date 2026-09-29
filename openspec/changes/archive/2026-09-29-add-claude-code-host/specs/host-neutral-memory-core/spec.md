# Spec Delta

## MODIFIED Requirements

### Requirement: Live capture uses one model rule on both hosts

OpenCode and Pi SHALL choose the model for automatic capture and profile learning in the same order:

1. the host model: `opencodeProvider`/`opencodeModel` on OpenCode, `piProvider`/`piModel` on Pi, where the model value `inherit` means the session's model and the model value `external` means the external API
2. the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`), when no host model is set
3. the session's own model, when neither is set

When the host model is `external`, the provider value SHALL be ignored and every call SHALL go to the external API. When the host model is `external` and the external API is not fully configured, automatic capture on that host SHALL be disabled and the missing settings SHALL be reported. When another host model fails and the external API is fully configured, the call SHALL use the external API and the user SHALL be notified. When the external API is only partly configured and no host model is set, automatic capture SHALL be disabled and the missing settings SHALL be reported.

Claude Code SHALL use step 2 only. It SHALL have no host model setting and no session model path, because its hooks cannot call the session's model. When the external API is not fully configured, Claude Code automatic capture and profile learning SHALL be disabled and the missing settings SHALL be reported. The order for OpenCode and Pi SHALL NOT change.

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

#### Scenario: A host chooses the external API

- **WHEN** `piModel` is `external` and the external API is fully configured
- **THEN** Pi's automatic capture and profile learning SHALL call the external API
- **AND** OpenCode SHALL keep using its own host model

#### Scenario: The same choice on both hosts

- **WHEN** `opencodeModel` is `external` on OpenCode and `piModel` is `external` on Pi, with the same external API settings
- **THEN** both hosts SHALL call the same external model

#### Scenario: A host chooses an unconfigured external API

- **WHEN** `opencodeModel` is `external` and `memoryApiUrl` is not set
- **THEN** OpenCode's automatic capture SHALL be disabled and `memoryApiUrl` SHALL be reported as missing

#### Scenario: Claude Code with nothing configured

- **WHEN** no external API settings exist and a Claude Code turn ends
- **THEN** no model call SHALL be made
- **AND** the missing settings SHALL be reported

#### Scenario: Claude Code with the external API configured

- **WHEN** the external API is fully configured and a Claude Code turn ends
- **THEN** the capture SHALL call the external API
- **AND** the OpenCode and Pi model choice SHALL be unchanged

### Requirement: History import has the same options on both hosts

The OpenCode, Pi, and Claude Code history imports SHALL accept one option set, parsed by one shared parser, both in a session and from the terminal. Only the history location flag SHALL differ: `--db` for OpenCode, `--root` for Pi, and `--root` for Claude Code. The default scope SHALL be the current project on every host. Claude Code SHALL have a terminal import only, because it has no in-session command surface.

#### Scenario: The same flags on both hosts

- **WHEN** the maintainer passes `--dry-run --scope all-projects --since 2026-01-01 --skip-memories` to either import
- **THEN** both imports SHALL apply the same filters and report in the same format

#### Scenario: A bare end date

- **WHEN** `--until 2026-03-31` is given
- **THEN** work units from the whole of 31 March 2026 SHALL be included

#### Scenario: The same flags on the Claude Code import

- **WHEN** the maintainer passes `--dry-run --scope all-projects --since 2026-01-01` to `import-claude-history`
- **THEN** the import SHALL apply the same filters and report in the same format as the other two
