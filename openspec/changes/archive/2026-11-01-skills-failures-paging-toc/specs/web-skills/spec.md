## MODIFIED Requirements

### Requirement: The skill view groups repeated failures

The view for one skill SHALL show a **Failures** section below its recent turns. The section SHALL group the skill's failed calls by tool name and the first line of the error text, cut to 200 characters. Calls with no error text SHALL form one group per tool name. A trailing carriage return SHALL NOT be part of the first line. The section SHALL show at most 50 groups, the ones with the most calls first.

#### Scenario: One error repeats across turns

- **WHEN** the same tool fails with the same first error line in 5 turns that used the skill
- **THEN** the Failures section SHALL show one group with 5 calls over 5 turns

#### Scenario: Different errors form separate groups

- **WHEN** one tool fails with two different first error lines
- **THEN** the Failures section SHALL show two groups for that tool

#### Scenario: Many groups

- **WHEN** a skill has 60 groups
- **THEN** the Failures section SHALL show the 50 groups with the most calls

### Requirement: A failure group shows its counts and sample

Each group SHALL show the number of calls, the number of turns, the last time seen and a sample error. The groups SHALL page with the shared paged-list toolbar and footer, at the default page size of 5. The default order SHALL be by number of calls, most first, and the reader SHALL be able to change it with the shared sort control.

#### Scenario: Group order

- **WHEN** one group has 9 calls and another has 3
- **THEN** the group with 9 calls SHALL appear first under the default sort

#### Scenario: Paging the groups

- **WHEN** the Failures section holds 8 groups
- **THEN** the section SHALL show the first 5 with the shared footer
- **AND** the footer SHALL offer the second page

## ADDED Requirements

### Requirement: The Skills page offers a table of contents

The Skills page (the list view) SHALL show the same floating table-of-contents control as the skill view, without a back entry: a small control fixed at the top end of the screen, which expands into the page's sections in page order and minimises back to its icon. Selecting a section SHALL scroll to it at once and outline it for a moment. The choice SHALL persist per browser, under its own key. The control SHALL NOT show while one skill's view is open.

#### Scenario: Jump from the list

- **WHEN** the reader selects **Pending proposals** in the table of contents
- **THEN** the page SHALL scroll to the Pending proposals section and outline it for a moment

#### Scenario: One skill's view keeps its own contents

- **WHEN** the reader opens one skill
- **THEN** the page's table of contents SHALL be replaced by the skill view's own contents

### Requirement: The skill view offers a table of contents

The skill view SHALL show a small table-of-contents control pinned to the top end of the view. The control SHALL expand into a list that starts with **All skills**, which leaves the skill view and returns to the list, followed by the view's sections in page order, and minimise back to its icon. Selecting a section SHALL scroll the page to that section at once and outline it for a moment. The expanded or minimised choice SHALL persist per browser.

#### Scenario: Return to the list

- **WHEN** the reader selects **All skills** in the table of contents
- **THEN** the view SHALL return to the skills list

#### Scenario: Jump to a section

- **WHEN** the reader selects **Proposals** in the table of contents
- **THEN** the view SHALL scroll to the Proposals section and outline it for a moment

#### Scenario: Minimise

- **WHEN** the reader selects the control's icon while it is expanded
- **THEN** the control SHALL collapse to its icon
- **AND** the collapsed choice SHALL persist after a reload
