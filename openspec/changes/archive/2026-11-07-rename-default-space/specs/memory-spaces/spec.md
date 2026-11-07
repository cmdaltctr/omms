## ADDED Requirements

### Requirement: The Default space has a display name the user can change

The registry SHALL hold an optional custom display name for the Default space. When it is set, every surface that names the Default space SHALL show it. When it is not set, or when the registry cannot be read, the name SHALL be "Default". The id SHALL stay `default` and the Default space SHALL keep using the global store folder.

#### Scenario: The user renames Default

- **WHEN** the user renames the Default space to `Main` in the web app
- **THEN** OMMS SHALL save the name in `spaces.json`, and the card, the sidebar tree, the status and the context line `Active memory space: Main` SHALL show `Main`
- **AND** the id SHALL still be `default` and the store folder SHALL be unchanged

#### Scenario: The custom name survives a restart

- **WHEN** OMMS restarts after the rename and Default is active
- **THEN** the active space name SHALL be `Main`

#### Scenario: The registry cannot be read

- **WHEN** `spaces.json` is missing or not valid
- **THEN** the Default space SHALL be named "Default"

#### Scenario: The user restores the original name

- **WHEN** the user renames the Default space to `Default`
- **THEN** OMMS SHALL remove the custom name from `spaces.json`

### Requirement: The Default name follows the display name rules

The custom name of the Default space SHALL have 1 to 60 characters and SHALL be unique without regard to case across all spaces. A rename of Default SHALL be possible only in the web app, as for every other space.

#### Scenario: The name is taken

- **WHEN** the user renames Default to `experiments` and a space named `Experiments` exists
- **THEN** OMMS SHALL refuse with a message that names the existing space

#### Scenario: A host other than the web app asks for the rename

- **WHEN** the CLI or the `memory` tool is asked to rename the Default space
- **THEN** OMMS SHALL refuse and SHALL say that only the web app can rename a space
