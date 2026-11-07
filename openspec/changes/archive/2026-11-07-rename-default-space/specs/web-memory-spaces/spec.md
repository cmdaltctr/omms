## ADDED Requirements

### Requirement: A pencil on every card edits the name and the icon, Default included

Each card, including the Default card, SHALL have a pencil button that opens a dialog in the design of the Change icon dialog on the Memory page. The dialog SHALL let the user change the display name, upload an image, pick an icon from a searchable list, or reset to the default avatar. The new avatar SHALL show on the card and in the sidebar tree. The choices SHALL be saved outside every space folder, so a switch does not hide them.

#### Scenario: Rename and pick an icon

- **WHEN** the user opens the pencil dialog of `Experiments`, enters `Lab`, picks an icon and saves
- **THEN** the card and the tree child SHALL show `Lab` with the chosen icon

#### Scenario: The Default name can be edited

- **WHEN** the user opens the pencil dialog of Default, enters `Main` and saves
- **THEN** the name field SHALL be enabled, and the card, the tree item and the status SHALL show `Main`

#### Scenario: Icons survive a switch

- **WHEN** the user sets an icon on a space and then activates another space
- **THEN** the icon SHALL still show on its card

## REMOVED Requirements

### Requirement: A pencil on each card edits the name and the icon

**Reason**: The old requirement fixes the Default name and has a scenario that tests the lock. The Default name is now editable.
**Migration**: Use "A pencil on every card edits the name and the icon, Default included". Its first and third scenarios repeat the old ones unchanged.
