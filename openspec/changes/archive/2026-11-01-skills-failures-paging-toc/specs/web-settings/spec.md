## ADDED Requirements

### Requirement: The Settings page offers a table of contents

The Settings page SHALL show the same floating table-of-contents control as the Skills pages, without a back entry: a small control fixed at the top end of the screen, out of the page flow. It SHALL expand into the settings cards in page order and minimise back to its icon. The expanded or minimised choice SHALL persist per browser under its own key.

#### Scenario: Jump to a card

- **WHEN** the reader selects **Skill learning** in the table of contents
- **THEN** the page SHALL scroll to the Skill learning card at once and outline it for a moment

#### Scenario: Minimise persists

- **WHEN** the reader minimises the contents and reloads the page
- **THEN** the control SHALL stay minimised

#### Scenario: The list does not run past the screen

- **WHEN** the expanded list is taller than the screen
- **THEN** the list SHALL cap its height and scroll inside itself
