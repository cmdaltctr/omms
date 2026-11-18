## ADDED Requirements

### Requirement: The Settings page shows one section per chip

The Settings page SHALL show a row of chip buttons below the search box, one chip per Settings section, in the current section order and with the section titles in the page's language. The page SHALL show only the selected section. The selected chip SHALL be marked as pressed for assistive technology. On a narrow screen the chips SHALL wrap onto more rows.

#### Scenario: Choosing a chip

- **WHEN** the user selects the **Log** chip
- **THEN** the page SHALL show only the Log section
- **AND** the Log chip SHALL be marked as pressed and every other chip as not pressed

#### Scenario: Chips on a phone

- **WHEN** the page is 390 pixels wide
- **THEN** every chip SHALL be visible, wrapped onto more rows, with no horizontal scrolling

### Requirement: The address names the selected Settings section

The address SHALL name the selected section with its existing anchor, for example `/settings#settings-section-log`. `/settings` without a section anchor SHALL show the first section, **Memory basics**. Selecting a chip SHALL add a history entry, so the browser Back button returns to the section shown before.

#### Scenario: Reloading a section

- **WHEN** the user reloads `/settings#settings-section-embedding`
- **THEN** the page SHALL show the Embedding section with its chip pressed

#### Scenario: Opening Settings without a section

- **WHEN** the user opens `/settings`
- **THEN** the page SHALL show the Memory basics section

#### Scenario: Going back

- **WHEN** the user selects **Health** and then **Log**, and then presses the browser Back button
- **THEN** the page SHALL show the Health section

### Requirement: A chip shows its section without moving the chips away

Selecting a chip SHALL keep the chip row in view and SHALL NOT outline the section. A link from outside the chip row SHALL keep the current behaviour: it scrolls to the section and outlines it for a moment.

#### Scenario: Selecting a chip

- **WHEN** the user selects the **Models** chip
- **THEN** the chip row SHALL stay in view
- **AND** the Models section SHALL show without the outline flash

### Requirement: Existing Settings links select the matching chip

Every link that names a Settings section SHALL select its chip and bring the section into view. This SHALL apply to the sidebar Settings tree, Settings search results, links on other pages, and direct loads of a section address.

#### Scenario: Following a sidebar link

- **WHEN** the user is on the Memory basics section and selects **Skill learning** in the sidebar Settings tree
- **THEN** the page SHALL show the Skill learning section with its chip pressed

#### Scenario: Following the welcome panel link

- **WHEN** the user selects the External API link on the welcome panel
- **THEN** Settings SHALL open with the External API section shown and its chip pressed

#### Scenario: Choosing a search result

- **WHEN** the user searches for `retention` and chooses a result on the Memory cleanup card
- **THEN** the page SHALL show the Memory cleanup section with its chip pressed
- **AND** keyboard focus SHALL move to the card heading

## REMOVED Requirements

### Requirement: The Settings page offers a table of contents

**Reason**: The section chips replace the floating table of contents. With one section shown at a time, a list that jumps within the page has no purpose.

**Migration**: Select a section chip below the search box, or use the sidebar Settings tree. The Skills pages keep their table of contents.
