## MODIFIED Requirements

### Requirement: Applying a cleanup only renames categories

Applying a cleanup SHALL set the category of each item in each accepted group to the group's name, after the label tidying rules, on the profile as it is stored when the user applies. It SHALL NOT change any item's description, evidence, frequency, confidence or vectors, and SHALL NOT add, merge or remove any item. The change SHALL be saved as one profile changelog entry that names it as a category cleanup. Applying SHALL NOT require the profile to be unchanged since the preview was built. Applying SHALL fail without changes when another save lands while it writes.

#### Scenario: Items keep their content

- **WHEN** a cleanup renames 12 items
- **THEN** the profile SHALL hold the same number of items as before
- **AND** each renamed item SHALL keep its description, evidence and frequency

#### Scenario: The profile changed after the preview

- **WHEN** profile learning saves a new version between the preview and the apply
- **THEN** applying SHALL succeed
- **AND** every item in the newer profile whose category is a label of an accepted group SHALL get the group's name
- **AND** items that learning added or changed SHALL keep everything except that category

#### Scenario: A label no longer exists

- **WHEN** learning removed every item of an accepted group's labels after the preview
- **THEN** applying SHALL succeed and report 0 items renamed
- **AND** SHALL NOT write a changelog entry

#### Scenario: A save lands while applying

- **WHEN** another save changes the stored profile between the moment apply reads it and the moment apply writes it
- **THEN** applying SHALL fail with a message to try again
- **AND** the stored profile SHALL keep the version that the other save wrote
