# Spec Delta

## MODIFIED Requirements

### Requirement: Pi extraction uses Pi's model runtime

The Pi adapter SHALL use the Pi model/runtime exposed through extension context for extraction and profile-learning model calls whenever the live-model rule selects a Pi model: `piProvider`/`piModel` (where `inherit` means the session's model), or the session's model when nothing is configured. When no Pi model is configured and the external API is fully configured, the adapter SHALL use the external API. When a configured Pi model fails or is not in Pi's model registry and the external API is fully configured, the adapter SHALL fall back to the external API.

#### Scenario: A memory extraction request is needed

- **WHEN** automatic Pi capture needs a model
- **THEN** the adapter SHALL resolve an allowed model using Pi context/model-registry APIs
- **AND** it SHALL call the model through Pi's provider-aware model runtime rather than opening a synthetic Pi conversation

#### Scenario: The pinned Pi model is unavailable

- **WHEN** `piProvider`/`piModel` name a model that fails or is not in Pi's registry, and the external API is fully configured
- **THEN** the adapter SHALL use the external API for that call
