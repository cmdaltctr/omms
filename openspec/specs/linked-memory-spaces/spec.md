# linked-memory-spaces Specification

## Purpose

Lets a space read the memories of other spaces without ever writing to them, so a line of work can build on earlier work while each store stays separate.

## Requirements

### Requirement: A space can link other spaces

Each space SHALL have a list of linked spaces. A link is one-way: it lets the space read the linked space and gives the linked space no access in return. A link SHALL NOT point to the space itself, SHALL NOT repeat, and SHALL point to an existing space. Links SHALL NOT be followed further: a linked space's own links SHALL NOT apply.

#### Scenario: Link two spaces

- **WHEN** the user links `Experiments` to `Default`
- **THEN** `Experiments` SHALL list `Default` as a linked space
- **AND** `Default` SHALL NOT list `Experiments`

#### Scenario: Link to itself

- **WHEN** the user links a space to itself
- **THEN** OMMS SHALL refuse and SHALL change nothing

#### Scenario: Links are not followed further

- **WHEN** `A` links `B`, and `B` links `C`
- **THEN** a search in `A` SHALL read `A` and `B` and SHALL NOT read `C`

### Requirement: Memory search also reads linked spaces

A memory search in a space SHALL also search its linked spaces, for the project in use and for an all-projects search. A linked space SHALL be skipped, and the result SHALL carry a warning that names it, when the space is archived, its folder is missing, its embedding dimensions differ from the current settings, or it records an embedding model that differs from the current model. A space that records no model SHALL be checked by its dimensions only.

#### Scenario: Recall from a linked space

- **WHEN** `Experiments` links `Default` and the user's prompt matches a memory that only `Default` holds
- **THEN** the search SHALL return that memory

#### Scenario: Linked space is missing

- **WHEN** a linked space's folder no longer exists
- **THEN** the search SHALL return the results of the other spaces and SHALL warn that the linked space was skipped

#### Scenario: Linked space with other dimensions

- **WHEN** a linked space was embedded with other dimensions than the current settings
- **THEN** the search SHALL skip it and SHALL warn that it needs a re-embed

#### Scenario: Linked space with another model and the same dimensions

- **WHEN** a linked space records `model-a` with 768 dimensions and the current settings use `model-b` with 768 dimensions
- **THEN** the search SHALL skip it and SHALL warn that it needs a re-embed

#### Scenario: Linked space with no recorded model

- **WHEN** a linked space records no embedding model and its dimensions equal the current settings
- **THEN** the search SHALL read it

### Requirement: Own-space results rank first

A search result list SHALL put results from the space in use before results from linked spaces. Linked results SHALL fill only the places that remain within the result limit, ordered by similarity. A linked result SHALL NOT displace an own-space result.

#### Scenario: Own results first

- **WHEN** the limit is 5 and the own space has 4 matches and a linked space has 3 better matches
- **THEN** the list SHALL hold the 4 own results first, then the best 1 linked result

#### Scenario: Own space is empty

- **WHEN** the own space has no match and a linked space has 2
- **THEN** the list SHALL hold those 2 linked results

### Requirement: A linked result names its space

A result from a linked space SHALL carry the display name of that space. The memory context block that hosts add to a session SHALL show the space name on each linked memory. Pi, OpenCode V2 and Claude Code SHALL use the same label. A result from the space in use SHALL carry no such label.

#### Scenario: Context shows the label

- **WHEN** a recalled memory comes from the linked space `Default`
- **THEN** its entry in the memory context block SHALL name `Default`

#### Scenario: Own memory has no label

- **WHEN** a recalled memory comes from the space in use
- **THEN** its entry SHALL carry no space label

### Requirement: Linked spaces are read-only

OMMS SHALL NOT write to a linked space because of a link. A search SHALL open the linked space for reading only, SHALL create no file in it and SHALL NOT change its schema. A memory operation that targets a memory of a linked space, such as forget or edit, SHALL be refused with the name of the linked space.

#### Scenario: Search leaves the linked space unchanged

- **WHEN** a search reads a linked space
- **THEN** every file in the linked space folder SHALL be byte-identical afterwards

#### Scenario: Forget a linked memory

- **WHEN** the agent asks to forget a memory that comes from a linked space
- **THEN** OMMS SHALL refuse, SHALL name the linked space and SHALL change nothing

#### Scenario: Capture stays in the own space

- **WHEN** a host captures a memory while linked spaces exist
- **THEN** OMMS SHALL write the memory to the space in use only

### Requirement: Links can be changed in the web app, the CLI and the tool

The web app, the CLI (`om-memory-system space link` and `unlink`) and the `memory` tool `space` mode SHALL link and unlink spaces. A link change SHALL apply to every host from its next turn. Removing a link SHALL delete no memory. Deleting or archiving a linked space SHALL leave the link in place and SHALL show it as unavailable.

#### Scenario: Unlink keeps data

- **WHEN** the user unlinks `Default` from `Experiments`
- **THEN** both spaces SHALL keep all their memories and later searches in `Experiments` SHALL NOT read `Default`

#### Scenario: A linked space is deleted

- **WHEN** the user deletes a space that another space links
- **THEN** the link SHALL remain in the registry and SHALL be shown as unavailable
- **AND** searches SHALL skip it with a warning

#### Scenario: The agent links a space

- **WHEN** the agent calls the `memory` tool in `space` mode to link `Default` to the active space
- **THEN** OMMS SHALL add the link and SHALL apply it from the next turn
