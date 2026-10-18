## Purpose

Defines how the web UI shows the evidence behind each user profile item, so the user can check why the profile holds that item.

## ADDED Requirements

### Requirement: Evidence count opens an evidence dialog

Each preference, pattern, and workflow card that has one or more evidence items SHALL show the evidence count as a button. Activating the button with a pointer, touch, or the keyboard SHALL open a dialog for that item. A card with no evidence SHALL NOT show the button. The button SHALL show a pointer cursor on hover and SHALL change its text colour on hover and on keyboard focus. When the dialog closes, focus SHALL return to the button that opened it.

#### Scenario: Open the dialog from a card

- **WHEN** a preference card has 10 evidence items and the user activates its evidence button
- **THEN** a dialog SHALL open for that preference
- **AND** the dialog SHALL list the 10 evidence items in their stored order

#### Scenario: Keyboard access

- **WHEN** the evidence button has focus and the user presses Enter or Space
- **THEN** the dialog SHALL open
- **AND** pressing Escape SHALL close it and return focus to the button

#### Scenario: Hover

- **WHEN** the pointer moves over the evidence button
- **THEN** the cursor SHALL be a pointer
- **AND** the button text SHALL change colour

#### Scenario: Card without evidence

- **WHEN** a workflow card has no evidence items
- **THEN** the card SHALL NOT show an evidence button

### Requirement: Evidence dialog content

The dialog SHALL show the item's section, its description, and its hit count with a short explanation of what the hit count means. It SHALL list every evidence item as separate text. The list SHALL scroll when it is taller than the dialog. Evidence text SHALL be shown as plain text and SHALL NOT be interpreted as HTML or Markdown.

#### Scenario: Long evidence list

- **WHEN** the evidence items are taller than the dialog
- **THEN** the list SHALL scroll inside the dialog
- **AND** the dialog header and close control SHALL stay visible

#### Scenario: Markup in evidence

- **WHEN** an evidence item contains `<b>bold</b>`
- **THEN** the dialog SHALL show the characters `<b>bold</b>` as text

#### Scenario: Evidence stored as one string

- **WHEN** an item's evidence is stored as one string, not a list
- **THEN** the button SHALL show a count of 1
- **AND** the dialog SHALL list that string as one item

### Requirement: Manual write marker is readable

An evidence item that is exactly `manual-write` SHALL show as a translated label that says the item came from a manual memory write. It SHALL NOT show the raw marker.

#### Scenario: Manual write evidence

- **WHEN** a preference has the evidence items `manual-write` and `Use npm for JavaScript projects`
- **THEN** the dialog SHALL show the manual memory write label and the text `Use npm for JavaScript projects`

### Requirement: Evidence text is translated

The evidence button label, the dialog title, the hit count explanation, and the manual write label SHALL be available in every supported language. Evidence item text SHALL be shown as stored, without translation.

#### Scenario: Chinese interface

- **WHEN** the interface language is Chinese
- **THEN** the evidence button label and the dialog text SHALL be in Chinese
