# Spec Delta

## Purpose

Lets a user export the memories of one space to a file that a colleague can import into a new space of their own, with personal identifiers removed and with the embedding model checked on import.

## ADDED Requirements

### Requirement: Export writes one space to a file

OMMS SHALL export all project memories of one space, optionally limited by a date range, to one JSON file. Each memory SHALL keep its id, text, tags, type, creation and update times, pin state and project tag. The file SHALL record the OMMS version, the embedding model and the embedding dimensions. OMMS SHALL write the file atomically and SHALL NOT change the space.

#### Scenario: Export a space

- **WHEN** the user exports `Experiments` to a path
- **THEN** OMMS SHALL write one file that holds every project memory of `Experiments` and the embedding model and dimensions
- **AND** `Experiments` SHALL stay unchanged

#### Scenario: Export with a date range

- **WHEN** the user exports only memories created in October 2026
- **THEN** the file SHALL hold only those memories

#### Scenario: Export of an empty selection

- **WHEN** the selection holds no memory
- **THEN** OMMS SHALL write no file and SHALL say that there is nothing to export

### Requirement: Export holds no vectors

The export file SHALL NOT hold the stored vectors of any memory. The importing machine SHALL create its own vectors.

#### Scenario: Vectors are absent

- **WHEN** OMMS exports a space
- **THEN** the file SHALL hold no vector field for any memory

### Requirement: Export strips identifiers from structured fields

The export file SHALL NOT hold an absolute path, a user name, a display name, an email address or a repository URL in any structured field. This covers the project path, the project name, the user fields, the repository URL, and any path or name that the memory metadata holds. The project tag SHALL stay, because it is a hash.

#### Scenario: Structured fields are removed

- **WHEN** a memory has a project path, a user email, a user name and a repository URL
- **THEN** the exported memory SHALL hold none of them and SHALL hold its project tag

#### Scenario: Metadata holds a path

- **WHEN** a memory's metadata holds an absolute path
- **THEN** the exported metadata SHALL NOT hold that path

### Requirement: Export replaces paths and emails inside memory text

OMMS SHALL replace a home-folder path in memory text with `~` and SHALL replace an email address in memory text with `<email>`. Text inside `<private>` tags SHALL NOT be exported. The export result SHALL report how many paths and emails it replaced and SHALL say that free-text names are not detected.

#### Scenario: A path in the text

- **WHEN** a memory says "the config is in /Users/jo/work/app/config.json"
- **THEN** the exported text SHALL say "the config is in ~/work/app/config.json"

#### Scenario: An email in the text

- **WHEN** a memory contains "ask jo@example.org"
- **THEN** the exported text SHALL contain "ask <email>"

#### Scenario: A fully private memory

- **WHEN** a memory is wholly inside `<private>` tags
- **THEN** OMMS SHALL leave it out of the file

### Requirement: The profile and personal memories need an opt-in

Export SHALL leave out the learned user profile and the personal (user-scope) memories by default. Export SHALL include them only when the user ticks or passes an explicit opt-in. The profile in the file SHALL hold no user name, display name or email address.

#### Scenario: Default export

- **WHEN** the user exports without the opt-in
- **THEN** the file SHALL hold no profile and no user-scope memory

#### Scenario: Opt-in export

- **WHEN** the user exports with the opt-in
- **THEN** the file SHALL hold the profile facts and the user-scope memories, with the identity fields removed

### Requirement: Import creates a new space

Import SHALL read an export file into a new space that the user names. The file SHALL hold no space name. Import SHALL NOT write into an existing space. Import SHALL NOT change the active space. A name that is already taken SHALL be refused.

#### Scenario: Import into a new space

- **WHEN** the user imports a file and names the space `From Sam`
- **THEN** OMMS SHALL create `From Sam` and SHALL hold the imported memories there
- **AND** the active space SHALL stay as it was

#### Scenario: Name already used

- **WHEN** the user names a space that already exists
- **THEN** OMMS SHALL refuse, SHALL create no space and SHALL change no existing space

#### Scenario: The file holds no space name

- **WHEN** the exported space was named `Sam client work`
- **THEN** the file SHALL hold that name nowhere

### Requirement: Import keeps project tags unless the user picks one project

Import SHALL keep the project tag of each memory by default. When the user gives a project folder, Import SHALL give every project memory the project tag of that folder on the importing machine. User-scope memories SHALL always take the importing user's tag. A folder that does not exist SHALL be refused before any space is created.

#### Scenario: Default keeps the tags

- **WHEN** the user imports a file without a project folder
- **THEN** each project memory SHALL keep the project tag it had in the file

#### Scenario: Retag to one project

- **WHEN** the user imports a file that holds memories of three projects and gives the folder `~/work/app`
- **THEN** every project memory SHALL carry the project tag of `~/work/app`
- **AND** a project-scope search from `~/work/app` SHALL find them

#### Scenario: Folder does not exist

- **WHEN** the user gives a project folder that does not exist
- **THEN** OMMS SHALL refuse with the reason and SHALL create no space

### Requirement: Import embeds again and warns on a model mismatch

Import SHALL create new vectors for every memory with the embedding model of the importing machine. When the file's model or dimensions differ from the current settings, OMMS SHALL warn before the import starts, naming both. The warning SHALL NOT block the import.

#### Scenario: Same model

- **WHEN** the file's model and dimensions equal the current settings
- **THEN** OMMS SHALL import without a warning

#### Scenario: Different model

- **WHEN** the file says `model-a` with 768 dimensions and the machine uses `model-b` with 1024
- **THEN** OMMS SHALL warn that the file used `model-a` at 768 and that OMMS will embed again with `model-b` at 1024
- **AND** the import SHALL continue after the user confirms in the web app, or at once in the CLI

### Requirement: Import validates the file first

Import SHALL check the file before it creates a space. A file that is not JSON, is larger than 100 MB, has an unsupported schema version or fails validation SHALL be refused with a reason, and OMMS SHALL create no space.

#### Scenario: Invalid file

- **WHEN** the user imports a file that fails validation
- **THEN** OMMS SHALL refuse with the reason and SHALL create no space

#### Scenario: Newer schema

- **WHEN** the file has a schema version that this OMMS does not know
- **THEN** OMMS SHALL refuse and SHALL say to upgrade OMMS

#### Scenario: Import fails part-way

- **WHEN** embedding fails after the new space exists
- **THEN** OMMS SHALL remove the new space and its folder and SHALL report the failure

### Requirement: Export and import are not offered to the agent tool

The web app and the CLI SHALL offer export and import. The `memory` tool `space` mode SHALL refuse them and SHALL say to use the web app or the CLI.

#### Scenario: The agent asks to export

- **WHEN** the agent calls the `memory` tool in `space` mode with an export action
- **THEN** OMMS SHALL refuse and SHALL write no file
