# Spec Delta

## ADDED Requirements

### Requirement: Dropdowns with short options use a compact width

A dropdown whose options are short words or names SHALL use a compact width of about 18rem, capped at the available width: Scope in Sessions, Provider in External API, Memory language, the embedding Preset, and the date and time formats. A dropdown with long options, such as a model ID, SHALL keep the full width.

#### Scenario: Scope in Sessions

- **WHEN** the user opens a host's Sessions card on a 1280 px wide viewport
- **THEN** the Scope dropdown SHALL be about 18rem wide, not the full card width

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** a compact dropdown SHALL NOT be wider than its row
- **AND** the page SHALL NOT scroll horizontally

#### Scenario: A model picker

- **WHEN** the user opens the Models settings
- **THEN** the model dropdown SHALL keep the full width
