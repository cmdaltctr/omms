# memory-spaces Specification

## Purpose

Lets one user keep separate memory stores, called spaces, and choose one active space that every host and the web app use. Each space has its own memories and its own learned user profile.

## Requirements

### Requirement: Each space is one storage folder

Each space SHALL be one storage folder with the layout of the current store: memory shards, `metadata.db`, `user-profiles.db`, `user-prompts.db`, `chats.db` and `import-ledger.db`. The Default space SHALL use the global `storagePath`. Other spaces SHALL use `~/.omms/spaces/<id>/`. `skills.db` and the embedding model cache (`.cache`) SHALL stay in the global storage path and SHALL be shared by all spaces.

#### Scenario: The user upgrades with an existing store

- **WHEN** OMMS starts with an existing store in `~/.omms/data` and no `~/.omms/spaces.json`
- **THEN** the Default space SHALL be active and SHALL use `~/.omms/data`
- **AND** OMMS SHALL NOT move, copy or rewrite any existing file

#### Scenario: A new space starts empty

- **WHEN** the user creates the space `Experiments` and makes it active
- **THEN** memory search SHALL return no memories and the user profile SHALL be empty
- **AND** the Default space's memories and profile SHALL be unchanged

#### Scenario: Skill learning in a space

- **WHEN** skill learning records a turn while `Experiments` is active
- **THEN** the turn SHALL be stored in the global `skills.db`

### Requirement: A registry records the spaces and the active space

OMMS SHALL keep a registry at `~/.omms/spaces.json`. Each entry SHALL hold an id, a display name, the creation time, an archived flag and, for an archived space, the time of the archive. The registry SHALL name exactly one active space. When the file does not exist, the Default space SHALL be the only space and SHALL be active. OMMS SHALL write the registry atomically.

#### Scenario: The registry is written

- **WHEN** the user creates, renames, archives, unarchives, deletes or switches a space
- **THEN** OMMS SHALL replace `spaces.json` in one atomic step, so a reader sees either the old file or the new file

#### Scenario: The registry cannot be read

- **WHEN** `spaces.json` exists but is not valid
- **THEN** OMMS SHALL use the Default space, SHALL leave the file unchanged, and SHALL report the problem in the log and in the web app status

### Requirement: Space ids and names are safe and unique

A space id SHALL be lowercase letters, digits and single hyphens, 1 to 40 characters, derived from the name. The id `default` SHALL be reserved for the Default space. A display name SHALL be 1 to 60 characters and unique without regard to case. A space id SHALL NOT change after creation.

#### Scenario: The user creates a space with an unsafe name

- **WHEN** the user creates a space named `../Team B`
- **THEN** the id SHALL be `team-b` and the folder SHALL be `~/.omms/spaces/team-b/`

#### Scenario: The name is already used

- **WHEN** the user creates a space named `experiments` and `Experiments` exists
- **THEN** OMMS SHALL refuse with a message that names the existing space

### Requirement: One active space applies to every host

All hosts and the web server SHALL use the active space named in the registry, unless a config file sets `storagePath`. When the active space changes, each process SHALL close its open store connections and SHALL use the new space from its next turn or request. Work that started before the switch MAY finish in the old space.

#### Scenario: The user switches in the web app during a Pi session

- **WHEN** a Pi session is open in Default and the user switches to `Experiments` in the web app
- **THEN** the next Pi turn SHALL search and capture in `Experiments`
- **AND** OpenCode V2 and Claude Code SHALL also use `Experiments` from their next turn

#### Scenario: A config file sets storagePath

- **WHEN** the global or project config sets `storagePath`
- **THEN** OMMS SHALL use that folder for the Default space when the config is global, and SHALL use it instead of the active space when the config belongs to a project
- **AND** the memory context and the web app SHALL say that the project uses its own storage folder

#### Scenario: The active space folder is missing

- **WHEN** the registry names an active space whose folder no longer exists
- **THEN** OMMS SHALL use the Default space and SHALL report the problem in the log and in the web app status

### Requirement: Memory context names the active space

Every memory context block that OMMS adds to a session SHALL include one line that names the active space by its display name. Pi, OpenCode V2 and Claude Code SHALL use the same line.

#### Scenario: Recall in a non-default space

- **WHEN** OMMS adds recalled memories to a turn while `Experiments` is active
- **THEN** the memory context block SHALL include the line `Active memory space: Experiments`

### Requirement: The user can archive and unarchive a space

Archiving SHALL hide a space from the sidebar tree and SHALL keep its folder unchanged. An archived space SHALL NOT become active until the user unarchives it. The Default space and the active space SHALL NOT be archived.

#### Scenario: Archive a space

- **WHEN** the user archives `Experiments` while Default is active
- **THEN** `Experiments` SHALL disappear from the sidebar tree and SHALL appear on the Archive page
- **AND** its folder SHALL be unchanged

#### Scenario: Archive the active space

- **WHEN** the user tries to archive the active space
- **THEN** OMMS SHALL refuse and SHALL tell the user to switch to another space first

### Requirement: Deleting a space makes a verified backup first

Delete SHALL remove a space's folder and registry entry only after a backup of that space passes verification and the user confirms. The Default space and the active space SHALL NOT be deleted.

#### Scenario: Delete a space

- **WHEN** the user deletes `Experiments` and confirms
- **THEN** OMMS SHALL make and verify a backup, then remove the folder and the registry entry
- **AND** OMMS SHALL show the backup location

#### Scenario: The backup fails

- **WHEN** the backup or its verification fails during a delete
- **THEN** OMMS SHALL keep the space and its folder unchanged and SHALL report the failure

### Requirement: The user can back up a space

A backup SHALL copy every file of a space's folder into `~/.omms/backups/space-<id>-<timestamp>/`, with a manifest that lists each file's SHA-256 checksum and the space's id, name and OMMS version. OMMS SHALL verify the copy against the manifest before it reports success. A backup of the active space SHALL hold a consistent state of each database.

#### Scenario: Back up the active space

- **WHEN** the user backs up the active space while a host captures a memory
- **THEN** each database in the backup SHALL open without error and SHALL hold either the state before the capture or the state after it

#### Scenario: Verification fails

- **WHEN** a copied file does not match its manifest checksum
- **THEN** OMMS SHALL report the backup as failed and SHALL remove the incomplete backup folder

### Requirement: The user can restore a backup as a new space

Restore SHALL check every file against the backup manifest and SHALL then copy the files into a new space folder with a new registry entry. Restore SHALL NOT overwrite an existing space. Restore SHALL NOT change which space is active.

#### Scenario: Restore a backup

- **WHEN** the user restores a backup of `Experiments` while `Experiments` still exists
- **THEN** OMMS SHALL create a new space named `Experiments (restored <date>)` with the backup's files
- **AND** the existing `Experiments` space SHALL be unchanged

#### Scenario: The backup is damaged

- **WHEN** a file in the backup does not match the manifest
- **THEN** OMMS SHALL refuse the restore, SHALL create no space and SHALL name the damaged file

### Requirement: The CLI and the memory tool manage spaces

The `om-memory-system space` command SHALL list spaces, show the active space, create, archive and unarchive a space, and switch the active space by name or id. The `memory` tool SHALL offer a `space` mode with the same operations. Neither SHALL delete a space. Pi, OpenCode V2 and Claude Code SHALL offer the same `space` operations.

#### Scenario: The user asks the agent to switch

- **WHEN** the user tells the agent "save this work in space Aizat" and the agent calls the `memory` tool in `space` mode to switch to `Aizat`
- **THEN** OMMS SHALL make `Aizat` the active space and SHALL reply with the new active space name

#### Scenario: The agent creates and archives a space

- **WHEN** the agent calls the `memory` tool in `space` mode to create `Spike` and later to archive it while another space is active
- **THEN** OMMS SHALL create `Spike`, then archive it and keep its folder unchanged

#### Scenario: The agent tries to delete a space

- **WHEN** the agent calls the `memory` tool in `space` mode with a delete action
- **THEN** OMMS SHALL refuse and SHALL say that only the web app can delete a space

#### Scenario: Switch to an archived or unknown space

- **WHEN** the CLI or the tool asks to switch to a space that is archived or does not exist
- **THEN** OMMS SHALL refuse and SHALL list the spaces that can become active
