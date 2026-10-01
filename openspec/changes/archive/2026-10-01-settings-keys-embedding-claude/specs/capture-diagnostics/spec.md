## ADDED Requirements

### Requirement: External API attempts record their model

A capture attempt that uses the external API SHALL record the extraction path as external API, and SHALL record the provider and model that the call used. This SHALL apply to every host, Claude Code included, and to live capture and history import. Records written before this change SHALL stay unchanged.

#### Scenario: A Claude Code capture

- **WHEN** a Claude Code turn is captured with the external API set to provider `openai-chat` and model `glm-5.3`
- **THEN** its diagnostics record SHALL have path external API, provider `openai-chat`, and model `glm-5.3`

#### Scenario: A failed external API call

- **WHEN** the external API call fails with an HTTP error
- **THEN** the diagnostics record SHALL still contain the path, provider, and model
- **AND** it SHALL contain the failure reason code
