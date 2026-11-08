# Spec Delta

## MODIFIED Requirements

### Requirement: Dropdowns with short options use a compact width

A dropdown whose options are short words or names SHALL use a compact width of about 18rem, capped at the available width: Scope in Sessions, Provider in External API, Memory language, the embedding Preset, the date and time formats, and Model choice in each host's model card. These Settings inputs and control groups SHALL use the same compact width, capped at the available width: API URL and Model in the External API card, and the key-source group (Environment variable, Key file, Save key to a private file, and the input each choice shows), including the group's bordered box. A control that holds long values, such as a model ID or a typed provider/model value, SHALL keep the full width.

#### Scenario: Scope in Sessions

- **WHEN** the user opens a host's Sessions card on a 1280 px wide viewport
- **THEN** the Scope dropdown SHALL be about 18rem wide, not the full card width

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** a compact dropdown SHALL NOT be wider than its row
- **AND** the page SHALL NOT scroll horizontally

#### Scenario: A model picker

- **WHEN** the user opens the Models settings
- **THEN** the Model choice dropdown SHALL be about 18rem wide
- **AND** the manual model picker and the typed provider/model input SHALL keep the full width

#### Scenario: The External API card

- **WHEN** the user opens the External API card on a 1280 px wide viewport
- **THEN** the API URL input and the Model input SHALL be about 18rem wide, not the full card width

#### Scenario: The key source group

- **WHEN** the user chooses Save key to a private file in the External API card
- **THEN** the option rows and the input the choice shows SHALL be about 18rem wide
- **AND** the group's bordered box SHALL be about 18rem wide
