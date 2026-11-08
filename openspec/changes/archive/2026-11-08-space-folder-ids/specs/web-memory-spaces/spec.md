## MODIFIED Requirements

### Requirement: Card actions are a play button and icon buttons

A card SHALL have an Activate button with a play icon, and icon-only buttons to transfer, export, archive or unarchive, to back up, to open the folder and to delete, each with a tooltip that names the action. The active space SHALL have no Activate button. The page SHALL disable each action that the space does not allow, and the tooltip of a disabled button SHALL say why.

#### Scenario: Blocked actions explain themselves

- **WHEN** the user points at the delete button of Default
- **THEN** the button SHALL be disabled and its tooltip SHALL give the reason

#### Scenario: Activate a space

- **WHEN** the user chooses Activate on the card of `Client work`
- **THEN** `Client work` SHALL become the active space

#### Scenario: Transfer and export are present

- **WHEN** the user views the card of `Client work`
- **THEN** the card SHALL show a transfer button and an export button with tooltips

### Requirement: A pencil on every card edits the name and the icon, Default included

Each card, including the Default card, SHALL have a pencil button that opens a dialog in the design of the Change icon dialog on the Memory page. The dialog SHALL let the user change the display name, upload an image, pick an icon from a searchable list, or reset to the default avatar. The dialog SHALL NOT show a note about the folder name. The new avatar SHALL show on the card and in the sidebar tree. The choices SHALL be saved outside every space folder, so a switch does not hide them.

#### Scenario: Rename and pick an icon

- **WHEN** the user opens the pencil dialog of `Experiments`, enters `Lab`, picks an icon and saves
- **THEN** the card and the tree child SHALL show `Lab` with the chosen icon

#### Scenario: The Default name can be edited

- **WHEN** the user opens the pencil dialog of Default, enters `Main` and saves
- **THEN** the name field SHALL be enabled, and the card, the tree item and the status SHALL show `Main`

#### Scenario: Icons survive a switch

- **WHEN** the user sets an icon on a space and then activates another space
- **THEN** the icon SHALL still show on its card

#### Scenario: No folder note

- **WHEN** the user opens the pencil dialog of any space
- **THEN** the dialog SHALL NOT contain the text "Only the name changes. The folder keeps its name."

## ADDED Requirements

### Requirement: A card opens its space folder on disk

Each card SHALL have an icon-only Open folder button in the action row. Its tooltip SHALL name the action and SHALL show the full folder path. Selecting it SHALL open the folder in the system file manager: Finder on macOS, File Explorer on Windows, and the default file manager through `xdg-open` on Linux. When the folder cannot be opened, the card SHALL show the reason.

#### Scenario: Open the Default folder

- **WHEN** the user selects Open folder on the Default card on macOS
- **THEN** Finder SHALL open `~/.omms/data`, or the configured storage path

#### Scenario: The tooltip shows the path

- **WHEN** the user points at the Open folder button of `Tech`
- **THEN** the tooltip SHALL show "Open folder" and the path of the `Tech` folder

### Requirement: The server opens only registry folders for local requests

The web server SHALL open a folder only for a space in the registry, using the folder path from the registry and never a path from the request. It SHALL accept the request only from a loopback address, and SHALL start the file manager without a shell.

#### Scenario: A remote request is refused

- **WHEN** a request to open a space folder comes from a non-loopback address
- **THEN** the server SHALL refuse it and SHALL start no process

#### Scenario: An unknown space is refused

- **WHEN** a request names a space id that is not in the registry
- **THEN** the server SHALL refuse it and SHALL start no process
