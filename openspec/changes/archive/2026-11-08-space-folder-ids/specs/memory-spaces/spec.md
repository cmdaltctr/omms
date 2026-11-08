## MODIFIED Requirements

### Requirement: Space ids and names are safe and unique

A new space SHALL get a random id: `space-` plus 10 lowercase letters and digits, never derived from the display name. OMMS SHALL redraw an id that the registry or a folder already holds. Every id SHALL be lowercase letters, digits and single hyphens, 1 to 40 characters, and `default` SHALL be reserved for the Default space. A display name SHALL be 1 to 60 characters and unique without regard to case. A space id SHALL NOT change after creation, and OMMS SHALL keep existing ids.

#### Scenario: The user creates a space with an unsafe name

- **WHEN** the user creates a space named `../Team B`
- **THEN** the display name SHALL be `../Team B`, the id SHALL match `space-[a-z0-9]{10}`, and the folder SHALL be `~/.omms/spaces/<id>/`

#### Scenario: The name is already used

- **WHEN** the user creates a space named `experiments` and `Experiments` exists
- **THEN** OMMS SHALL refuse with a message that names the existing space

#### Scenario: A renamed space's old name is free again

- **WHEN** the user renames `Work` to `Tech` and then creates a space named `Work`
- **THEN** OMMS SHALL create the new space with a new random id and SHALL NOT refuse

#### Scenario: An existing space keeps its id

- **WHEN** OMMS starts with a registry that holds the space id `work`
- **THEN** the space SHALL keep the id `work` and the folder `~/.omms/spaces/work/`

## ADDED Requirements

### Requirement: Each space folder holds a space.json label

Every space folder, the Default storage folder included, SHALL hold a file `space.json` with the space id, the display name and the creation time. OMMS SHALL write it when it creates a space, SHALL rewrite it atomically when the space is renamed, and SHALL add it at start-up to a folder that has none. The registry SHALL stay the only source OMMS reads to find, name or list spaces. A missing or unreadable `space.json` SHALL NOT change any space behaviour.

#### Scenario: A rename updates the label

- **WHEN** the user renames `Work` to `Tech`
- **THEN** `space.json` in that space's folder SHALL hold the name `Tech`

#### Scenario: An older folder gets a label

- **WHEN** OMMS starts and a space folder has no `space.json`
- **THEN** OMMS SHALL write one from the registry entry and SHALL change no other file in the folder

#### Scenario: A broken label is ignored

- **WHEN** `space.json` in a space folder is not valid JSON
- **THEN** the space SHALL keep its name from the registry, and OMMS SHALL rewrite the file on the next rename or start-up

### Requirement: Output names a space by its display name

The CLI and the `memory` tool SHALL name each space by its display name. When the output also shows the id, the id SHALL follow the name. Every command and tool action that takes a space SHALL accept the display name, without regard to case, or the id.

#### Scenario: Listing spaces

- **WHEN** the user runs `om-memory-system space list`
- **THEN** each line SHALL start with the display name, and the id SHALL appear after it

#### Scenario: Using a space by name

- **WHEN** an agent calls the `memory` tool with mode `space`, action `use` and name `tech`
- **THEN** OMMS SHALL switch to the space named `Tech`
