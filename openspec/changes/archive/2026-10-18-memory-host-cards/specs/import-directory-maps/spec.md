## MODIFIED Requirements

### Requirement: Unresolved counts agree across the page

The number of unresolved sessions shown for a host and the directories listed for that host SHALL come from the newest record that covered the host's whole history, after removing directories in `importIgnoredDirectories`. A full run, a preview without a date limit, and a session listing in either scope cover the whole history, because a listing finds unresolved sessions across the whole source. An automatic backfill covers only history before its cutoff, so its record SHALL NOT replace a whole-history record, and SHALL be used only while the host has no whole-history record. Sessions recorded with no directory SHALL be counted and shown as one entry, **No directory recorded**, which cannot be mapped or ignored.

#### Scenario: Card and list match

- **WHEN** the latest Claude Code run found 27 unresolved sessions in 9 directories, and 2 sessions with no directory
- **THEN** the Claude Code status SHALL show 27 unresolved sessions
- **AND** the Claude Code view SHALL list 9 directories and one No directory recorded entry, whose session counts add up to 27

#### Scenario: Card and list match after ignoring

- **WHEN** the latest Pi run found 10 unresolved sessions and the user ignores a directory with 6 of them
- **THEN** the Pi status and the Pi view SHALL both show 4 unresolved sessions

#### Scenario: Listing one project's sessions

- **WHEN** the user lists sessions for the current project only after a full run
- **THEN** the host's unresolved directories SHALL be the listing's whole-source result, which includes every directory the full run reported that is still unresolved

#### Scenario: A backfill after a listing

- **WHEN** an OpenCode session listing finds 21 unresolved sessions in 3 directories, and a later backfill limited to history before its cutoff finds none
- **THEN** the OpenCode status and view SHALL still show 21 unresolved sessions in 3 directories

#### Scenario: Only a backfill has run

- **WHEN** Pi has no whole-history record and its backfill found 4 unresolved sessions
- **THEN** the Pi status and view SHALL show 4 unresolved sessions

## ADDED Requirements

### Requirement: Users can ignore every listed unresolved directory at once

A host's group of unresolved directories SHALL offer **Ignore all** when it lists at least one directory that can be ignored. **Ignore all** SHALL open a confirmation that lists every directory it will ignore with its session count. Confirming SHALL save all of them to `importIgnoredDirectories` in one settings save, with the same validation and revision checks as **Ignore**. Cancelling SHALL save nothing. **Ignore all** SHALL NOT include the **No directory recorded** entry, and SHALL NOT change `importPathMaps`, the import ledger, or history files.

#### Scenario: Ignoring three temporary folders

- **WHEN** the OpenCode view lists 3 unresolved directories and the user selects **Ignore all** and confirms
- **THEN** the global config SHALL have all 3 directories in `importIgnoredDirectories`
- **AND** the OpenCode view SHALL list no unresolved directory

#### Scenario: Cancelling Ignore all

- **WHEN** the user selects **Ignore all** and then Cancel
- **THEN** `importIgnoredDirectories` SHALL stay unchanged

#### Scenario: Ignore all fails to save

- **WHEN** the save is rejected because settings changed elsewhere
- **THEN** every directory SHALL stay in the list
- **AND** the page SHALL show an accessible error and SHALL NOT retry by itself
