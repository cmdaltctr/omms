# Spec Delta

## Purpose

Shows the active memory space in the web app and lets the user see the spaces in a sidebar tree and switch and manage them on a Spaces page.

## ADDED Requirements

### Requirement: The sidebar has a Spaces item

The first sidebar navigation item SHALL be a boxes icon labelled `Spaces`, above Project memories, styled like the other items. It SHALL link to the Spaces page. A collapsed desktop sidebar SHALL show the icon only, and its hover text SHALL name the active space. The narrow-screen sidebar menu SHALL show the same item. The item SHALL read the active space from the existing status calls, with no new request schedule.

#### Scenario: The page opens in a non-default space

- **WHEN** `Experiments` is active and the page opens
- **THEN** the first sidebar item SHALL be `Spaces`, above Project memories

#### Scenario: The sidebar is collapsed

- **WHEN** the desktop sidebar is collapsed and `Experiments` is active
- **THEN** the item SHALL show the icon only, and its hover text SHALL name `Experiments`

#### Scenario: The project uses its own storage folder

- **WHEN** a config file sets `storagePath` for the project the web app serves
- **THEN** the Spaces item and the Spaces page SHALL say that a custom storage folder is in use

### Requirement: The Spaces item has a tree of the spaces

The Spaces item SHALL carry a collapsible tree of the spaces that are not archived, like the Memory item. Each child SHALL show the space's avatar, the space name and a success-colour mark when the space is active. A long name SHALL end in an ellipsis, with the full name on hover. Clicking a child SHALL open that space's card on the Spaces page and SHALL NOT switch the active space. The tree SHALL load the list again when the active space changes.

#### Scenario: The tree lists the spaces

- **WHEN** `Experiments` is active, and `Old` is archived
- **THEN** the tree SHALL list Default and `Experiments`, with `Experiments` marked active, and SHALL NOT list `Old`

#### Scenario: A switch happens outside the web app

- **WHEN** the user switches to `Aizat` through the CLI or the `memory` tool
- **THEN** the tree SHALL mark `Aizat` as active after the next status call, without a page reload

#### Scenario: A child opens its card

- **WHEN** the user clicks `Experiments` in the tree
- **THEN** the Spaces page SHALL open at the card of `Experiments`
- **AND** the active space SHALL NOT change

### Requirement: A space card switches the active space

Each space card on the Spaces page SHALL have an Activate action. Confirming it SHALL make the space active and SHALL reload the memories, the user profile and the chats shown on the page from the new space.

#### Scenario: Switch from a card

- **WHEN** the user chooses Activate on the card of `Experiments` and confirms
- **THEN** `Experiments` SHALL become active, its card and its tree child SHALL show the active mark, and the memory list SHALL show the memories of `Experiments`

#### Scenario: The switch fails

- **WHEN** the server refuses the switch
- **THEN** the previous space SHALL stay active and the page SHALL show the reason

### Requirement: The Spaces page shows a card for each space

The web app SHALL have a Spaces page, reached from the Spaces item. It SHALL show the spaces that are not archived as a grid of cards in the design of the Memory page, or as a list of rows, and the user SHALL be able to choose between the two. Each card SHALL have an avatar, the name, a state line, the folder size and the creation date. The active card SHALL have a success-colour outline and state line. A form SHALL create a space.

#### Scenario: The user opens the Spaces page

- **WHEN** Default is active and `Experiments` is archived
- **THEN** the page SHALL show a card for Default as active and SHALL NOT show a card for `Experiments`

#### Scenario: Create a space

- **WHEN** the user creates the space `Client work`
- **THEN** the page SHALL show a card for `Client work`

### Requirement: Card actions are a play button and icon buttons

A card SHALL have an Activate button with a play icon, and icon-only buttons to archive or unarchive, to back up and to delete, each with a tooltip that names the action. The active space SHALL have no Activate button. The page SHALL disable each action that the space does not allow, and the tooltip of a disabled button SHALL say why.

#### Scenario: Blocked actions explain themselves

- **WHEN** the user points at the delete button of Default
- **THEN** the button SHALL be disabled and its tooltip SHALL give the reason

#### Scenario: Activate a space

- **WHEN** the user chooses Activate on the card of `Client work`
- **THEN** `Client work` SHALL become the active space

### Requirement: Activate, archive, unarchive and back up ask first

Activate, archive, unarchive and back up on a card, and Activate after a create, SHALL each open a confirmation dialog that names the space and says what the action does. The request SHALL be sent only when the user confirms. While it runs, the dialog SHALL show progress. A server error SHALL show in the dialog, which SHALL stay open. Delete keeps its typed-name dialog.

#### Scenario: Cancel changes nothing

- **WHEN** the user chooses Archive on the card of `Experiments` and then Cancel
- **THEN** no request SHALL be sent and `Experiments` SHALL stay as it was

#### Scenario: Confirm runs the action

- **WHEN** the user chooses Back up on the card of `Experiments` and then confirms
- **THEN** the dialog SHALL show progress, then close, and the page SHALL show the backup location

#### Scenario: The server refuses

- **WHEN** the user confirms Activate and the server refuses
- **THEN** the dialog SHALL stay open and show the reason

### Requirement: The tree ends with an Archive child

The last child of the Spaces tree SHALL be Archive, with the layers icon that the Shared item has on the Memory page. It SHALL show even when no space is archived. Choosing it SHALL open the Archive page.

#### Scenario: The tree shows Archive last

- **WHEN** the Spaces tree is open
- **THEN** the last child SHALL be Archive, with the layers icon, after the last space

### Requirement: The Archive page lists archived spaces

Choosing Archive in the tree SHALL open a page with a list of the archived spaces in the style of the Backups list: the same toolbar, newest archive first, and one card for each space. A card SHALL show the avatar, name, archive date, creation date and size, with Restore, Back up and Delete. An archive made before OMMS recorded its date SHALL read "not recorded". Restore SHALL unarchive after a confirmation. With no archived space, the page SHALL say so.

#### Scenario: A space was archived

- **WHEN** the user archives `Experiments` and opens Archive
- **THEN** the list SHALL show a card for `Experiments` with its archive date, its creation date and its size

#### Scenario: Restore a space

- **WHEN** the user chooses Restore on `Experiments` and confirms
- **THEN** `Experiments` SHALL leave the list, return to the sidebar tree and show as a card on the Spaces page

#### Scenario: Nothing is archived

- **WHEN** no space is archived
- **THEN** the page SHALL say that no space is archived

### Requirement: A pencil on each card edits the name and the icon

Each card SHALL have a pencil button that opens a dialog in the design of the Change icon dialog on the Memory page. The dialog SHALL let the user change the display name, upload an image, pick an icon from a searchable list, or reset to the default avatar. The Default space name SHALL NOT be editable, and the dialog SHALL say why. The new avatar SHALL show on the card and in the sidebar tree. The choices SHALL be saved outside every space folder, so a switch does not hide them.

#### Scenario: Rename and pick an icon

- **WHEN** the user opens the pencil dialog of `Experiments`, enters `Lab`, picks an icon and saves
- **THEN** the card and the tree child SHALL show `Lab` with the chosen icon

#### Scenario: The Default name is fixed

- **WHEN** the user opens the pencil dialog of Default
- **THEN** the name field SHALL be disabled with a reason, and the icon controls SHALL work

#### Scenario: Icons survive a switch

- **WHEN** the user sets an icon on a space and then activates another space
- **THEN** the icon SHALL still show on its card

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
- **THEN** the Spaces item, the Spaces page and the dialogs SHALL show Arabic text
