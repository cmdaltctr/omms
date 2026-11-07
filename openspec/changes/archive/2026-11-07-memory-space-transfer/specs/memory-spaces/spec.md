# Spec Delta

## MODIFIED Requirements

### Requirement: A registry records the spaces and the active space

OMMS SHALL keep a registry at `~/.omms/spaces.json`. Each entry SHALL hold an id, a display name, the creation time, an archived flag, for an archived space the time of the archive, and an optional list of linked space ids. The registry SHALL name exactly one active space. When the file does not exist, the Default space SHALL be the only space and SHALL be active. OMMS SHALL write the registry atomically.

#### Scenario: The registry is written

- **WHEN** the user creates, renames, archives, unarchives, deletes, links, unlinks or switches a space
- **THEN** OMMS SHALL replace `spaces.json` in one atomic step, so a reader sees either the old file or the new file

#### Scenario: The registry cannot be read

- **WHEN** `spaces.json` exists but is not valid
- **THEN** OMMS SHALL use the Default space, SHALL leave the file unchanged, and SHALL report the problem in the log and in the web app status

#### Scenario: An older registry without links

- **WHEN** `spaces.json` was written before links existed
- **THEN** OMMS SHALL read it as valid and SHALL treat every space as having no linked spaces

### Requirement: The CLI and the memory tool manage spaces

The `om-memory-system space` command SHALL list spaces, show the active space, create, archive and unarchive a space, switch the active space by name or id, preview and copy memories between spaces, and link and unlink spaces. The `memory` tool SHALL offer a `space` mode with the same operations. Neither SHALL delete a space or move memories. Pi, OpenCode V2 and Claude Code SHALL offer the same `space` operations.

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

#### Scenario: The same operations in every host

- **WHEN** Pi, OpenCode V2 and Claude Code each call `space` mode with the preview, copy, link and unlink actions
- **THEN** each host SHALL accept the actions and SHALL return the same result for the same input
