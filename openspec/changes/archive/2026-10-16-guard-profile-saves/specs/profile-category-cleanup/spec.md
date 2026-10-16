## MODIFIED Requirements

### Requirement: The user reviews the cleanup before anything changes

Building a cleanup preview SHALL NOT change the stored profile. The preview SHALL show, for each group, its labels, their item counts and the proposed name. The user SHALL be able to reject a group and to edit a group's name before applying. The preview SHALL show the number of categories before and after the accepted groups, and SHALL state that later learning merges near-duplicate memories more readily inside one category. A group that the model checked SHALL start accepted. A group that the model did not check SHALL start rejected, and the user SHALL be able to accept it.

#### Scenario: A preview

- **WHEN** a user opens the cleanup preview
- **THEN** the stored profile SHALL stay unchanged
- **AND** the preview SHALL show the category count before and after

#### Scenario: A rejected group

- **WHEN** a user rejects one group and applies the rest
- **THEN** the items in the rejected group SHALL keep their categories

#### Scenario: An edited name

- **WHEN** a user changes a group's name to "Working style" and applies
- **THEN** every item in that group SHALL have the category "Working style"

#### Scenario: Groups the model did not check

- **WHEN** a preview holds 40 checked groups and 284 groups the model did not check
- **THEN** the 40 checked groups SHALL start accepted
- **AND** the 284 unchecked groups SHALL start rejected
- **AND** the category count after SHALL count only the 40 accepted groups

#### Scenario: The user accepts an unchecked group

- **WHEN** a user accepts one unchecked group and applies
- **THEN** every item in that group SHALL get the group's name
