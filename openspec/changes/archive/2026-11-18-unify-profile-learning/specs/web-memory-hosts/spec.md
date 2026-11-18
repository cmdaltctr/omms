## ADDED Requirements

### Requirement: The Profile learning row shows how learning behaves

The Profile learning row of `/memory/shared` SHALL show a settings table above the catch-up controls, with one row per learning behaviour. Six rows SHALL have a dropdown: no user email, fade old items, model input, check older items, notice when done, and during a catch-up run. Four rows SHALL show their fixed value as text: history entry, host model fails, reply check, and save clash. Each row SHALL show a plain name, one line of description, and the default.

#### Scenario: Opening the row

- **WHEN** the user opens the Profile learning row on `/memory/shared`
- **THEN** the table SHALL show ten rows
- **AND** the six dropdowns SHALL show the saved values, or the defaults when nothing is saved

#### Scenario: A narrow screen

- **WHEN** the page is 390 pixels wide
- **THEN** each row SHALL stack its name above its control without sideways scrolling

### Requirement: The learning dropdowns offer only behaviours that exist

Each dropdown SHALL offer only these options: no user email (Learn anyway, Skip), fade old items (Off, On), model input (Prompts with profile and guidance, Prompts only), check older items (Off, On), notice when done (On, Off), and during a catch-up run (Keep learning, Pause). The first option of each list SHALL be the default.

#### Scenario: The email row

- **WHEN** the user opens the no user email dropdown
- **THEN** it SHALL offer exactly Learn anyway and Skip

### Requirement: Learning settings save through the safe settings flow

**Save** SHALL write only the changed learning keys to the global config through the existing settings API, with its authentication, origin, validation, conflict and legacy-file rules. **Cancel** SHALL restore the saved values. Save SHALL be off while nothing changed or the settings view is read-only. A project config SHALL NOT be written. The page SHALL say that the settings apply to every host.

#### Scenario: Turning on decay

- **WHEN** the user sets fade old items to On and presses **Save**
- **THEN** the global config SHALL hold `"userProfileDecayBeforeMerge": true`
- **AND** every other key and comment SHALL be unchanged

#### Scenario: The file changed meanwhile

- **WHEN** another process changes the config file before the save
- **THEN** the save SHALL be refused without writing
- **AND** the section SHALL reload the values and ask the user to save again

### Requirement: Reset to default restores every learning default

The table SHALL offer **Reset to default**. After the user confirms, it SHALL remove the six learning keys from the global config through the same safe settings flow, so every row shows its default. Reset SHALL be off when none of the six keys is in the file.

#### Scenario: Resetting after changes

- **WHEN** the file holds `"userProfileWithoutEmail": "skip"` and `"userProfileValidationEnabled": true` and the user confirms **Reset to default**
- **THEN** both keys SHALL be removed from the global file
- **AND** the rows SHALL show Learn anyway and Off

#### Scenario: Nothing to reset

- **WHEN** none of the six keys is in the global file
- **THEN** **Reset to default** SHALL be off

### Requirement: The learning table works in every language

Every name, description, option and message in the learning table SHALL have Chinese and Arabic text. In Arabic the table SHALL use right-to-left layout, and config keys SHALL stay left-to-right.

#### Scenario: Arabic

- **WHEN** the language is Arabic and the user opens the Profile learning row
- **THEN** every label and option SHALL show in Arabic
- **AND** the config keys SHALL read left-to-right
