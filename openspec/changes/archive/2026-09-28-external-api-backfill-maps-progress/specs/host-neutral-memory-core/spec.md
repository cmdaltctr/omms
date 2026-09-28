## MODIFIED Requirements

### Requirement: Live capture uses one model rule on both hosts

OpenCode and Pi SHALL choose the model for automatic capture and profile learning in the same order:

1. the host model: `opencodeProvider`/`opencodeModel` on OpenCode, `piProvider`/`piModel` on Pi, where the model value `inherit` means the session's model and the model value `external` means the external API
2. the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`), when no host model is set
3. the session's own model, when neither is set

When the host model is `external`, the provider value SHALL be ignored and every call SHALL go to the external API. When the host model is `external` and the external API is not fully configured, automatic capture on that host SHALL be disabled and the missing settings SHALL be reported. When another host model fails and the external API is fully configured, the call SHALL use the external API and the user SHALL be notified. When the external API is only partly configured and no host model is set, automatic capture SHALL be disabled and the missing settings SHALL be reported.

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
