# Spec Delta

## Purpose

Gives the Spaces page of the web app the controls to transfer memories between spaces, export a space, import a file into a new space and manage the links of a space.

## ADDED Requirements

### Requirement: A transfer dialog previews before it applies

The Transfer button of a card SHALL open a dialog with the source space set to that card, a target space, a mode of Copy or Move, a date range and a project filter. The dialog SHALL show the preview (count, source projects, examples, skipped duplicates) before it offers Apply. Any change to the filter SHALL clear the preview and SHALL require a new one.

#### Scenario: Preview then apply

- **WHEN** the user picks a target and a date range and chooses Preview
- **THEN** the dialog SHALL show the count, the source projects, the examples and the duplicate count, and SHALL then enable Apply

#### Scenario: Filter changes

- **WHEN** the user changes the date range after a preview
- **THEN** the preview SHALL clear and Apply SHALL be disabled until a new preview runs

#### Scenario: No match

- **WHEN** the preview count is zero
- **THEN** the dialog SHALL say that nothing matches and SHALL keep Apply disabled

### Requirement: Move asks for a clear confirmation

Choosing Apply with the Move mode SHALL open a confirm dialog that names the source space, the target space and the count, and says that the memories leave the source after the copy is checked. The request SHALL be sent only after the user confirms. Copy SHALL use the same dialog without the removal sentence.

#### Scenario: Cancel a move

- **WHEN** the user chooses Apply with Move and then Cancel in the confirm dialog
- **THEN** no request SHALL be sent and both spaces SHALL stay as they were

#### Scenario: Move result

- **WHEN** the user confirms a move of 20 memories with 3 skipped duplicates
- **THEN** the dialog SHALL show 17 moved and 3 skipped, and the 3 SHALL be described as kept in the source

### Requirement: Export and Import have their own dialogs

The Export button of a card SHALL open a dialog with an optional date range and an unticked checkbox for the profile and personal memories. It SHALL show the counts of paths and emails replaced, then offer the file as a browser download. The page SHALL have an Import control that takes a file and a new space name, shows the model and dimension warning when it applies, and asks for confirmation before it runs.

#### Scenario: Export defaults

- **WHEN** the user opens the Export dialog
- **THEN** the profile checkbox SHALL be unticked and the text beside it SHALL say that ticking it adds personal data

#### Scenario: Import with a model warning

- **WHEN** the user picks a file whose embedding model differs from the current settings
- **THEN** the dialog SHALL show the warning with both models before the user confirms

#### Scenario: Import name taken

- **WHEN** the user enters a space name that already exists
- **THEN** the dialog SHALL show the reason, stay open and send no import

### Requirement: A card lists and edits its linked spaces

Each card SHALL show a Links section that lists the linked spaces by name. A linked space that is archived or deleted SHALL be marked unavailable in words. The section SHALL offer a control to link another space and an unlink button on each row. Both SHALL ask for confirmation first.

#### Scenario: Link a space

- **WHEN** the user links `Default` to the card of `Experiments` and confirms
- **THEN** the card SHALL list `Default` as a linked space

#### Scenario: Unlink

- **WHEN** the user unlinks `Default` and confirms
- **THEN** the row SHALL disappear and the dialog SHALL say that no memory was deleted

### Requirement: Transfer text is translated and accessible

Every string of the transfer, export, import and links controls SHALL exist in English, Chinese and Arabic. Layouts SHALL mirror in Arabic. A state SHALL be shown in words and not by colour alone. Space names SHALL be wrapped so that mixed-direction names display correctly.

#### Scenario: Arabic layout

- **WHEN** the user opens the Transfer dialog in Arabic
- **THEN** the dialog SHALL mirror and every label SHALL be in Arabic
