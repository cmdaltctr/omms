# Spec Delta

## Purpose

Shows the active memory space in the web app and lets the user switch and manage spaces from a globe item in the sidebar and a Spaces page.

## ADDED Requirements

### Requirement: The sidebar shows the active space

The first sidebar navigation item SHALL be a globe with the active space's name, above Project memories, styled like the other items. A long name SHALL end in an ellipsis, with the full name on hover. A collapsed desktop sidebar SHALL show the globe only. The narrow-screen sidebar menu SHALL show the same item. The item SHALL read the active space from the existing status calls, with no new request schedule.

#### Scenario: The page opens in a non-default space

- **WHEN** `Experiments` is active and the page opens
- **THEN** the first sidebar item SHALL show the globe and `Experiments`, above Project memories

#### Scenario: A switch happens outside the web app

- **WHEN** the user switches to `Aizat` through the CLI or the `memory` tool
- **THEN** the globe item SHALL show `Aizat` after the next status call, without a page reload

#### Scenario: The project uses its own storage folder

- **WHEN** a config file sets `storagePath` for the project the web app serves
- **THEN** the globe item SHALL say that a custom storage folder is in use

### Requirement: The switcher changes the active space

Clicking the globe item SHALL open a list of the spaces that are not archived, with the active space marked, and a link to the Spaces page. Choosing a space SHALL make it active and SHALL reload the memories, the user profile and the chats shown on the page from the new space.

#### Scenario: Switch from the sidebar

- **WHEN** the user opens the switcher and chooses `Experiments`
- **THEN** `Experiments` SHALL become active, the globe item SHALL show `Experiments`, and the memory list SHALL show the memories of `Experiments`

#### Scenario: The switch fails

- **WHEN** the server refuses the switch
- **THEN** the globe item SHALL keep the previous space and the page SHALL show the reason

### Requirement: The Spaces page manages spaces

The web app SHALL have a Spaces page, reached from the switcher. It SHALL list every space with its name, status (active, archived), folder size and creation date. It SHALL let the user create, rename, switch to, archive, unarchive, back up and delete a space. It SHALL disable each action that the space does not allow and SHALL say why.

#### Scenario: The user opens the Spaces page

- **WHEN** Default is active and `Experiments` is archived
- **THEN** the page SHALL list Default as active and `Experiments` as archived
- **AND** the delete and archive actions for Default SHALL be disabled with a reason

#### Scenario: Create a space

- **WHEN** the user creates the space `Client work`
- **THEN** the page SHALL list `Client work` and SHALL offer to switch to it

### Requirement: Delete asks for the space name

Before a delete, the page SHALL tell the user that OMMS makes a backup first and then removes the space. The user SHALL type the space's display name to confirm. After the delete, the page SHALL show the backup location.

#### Scenario: Confirm a delete

- **WHEN** the user types `Experiments` in the delete dialog for `Experiments` and confirms
- **THEN** the page SHALL show progress until the delete ends, then the backup location

#### Scenario: The typed name is wrong

- **WHEN** the typed name does not match the space's display name
- **THEN** the confirm button SHALL stay disabled

### Requirement: The Spaces page lists backups and restores them

The Spaces page SHALL list the space backups in `~/.omms/backups/` with the space name, the date and the size. Each backup SHALL offer **Restore as new space**. The page SHALL show the result of the restore or the name of the damaged file.

#### Scenario: Restore from the page

- **WHEN** the user chooses Restore as new space on a backup of `Experiments`
- **THEN** the page SHALL list a new space `Experiments (restored <date>)`

### Requirement: Space text is translated

All new text for spaces SHALL be available in every language the web app supports.

#### Scenario: The user reads the page in Arabic

- **WHEN** the web app language is Arabic
- **THEN** the switcher, the Spaces page and the dialogs SHALL show Arabic text
