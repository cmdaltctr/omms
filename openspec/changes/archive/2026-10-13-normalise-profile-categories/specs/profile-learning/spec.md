## ADDED Requirements

### Requirement: Categories that differ only in spelling are one category

The profile SHALL give each preference and pattern category a match key: trimmed, lower case, with `_`, `-` and runs of spaces turned into a single space. Two labels with the same key SHALL be the same category. This SHALL hold for items stored before this rule. The merge SHALL compare categories by key.

#### Scenario: A new item meets an old spelling

- **WHEN** a stored preference has the category "communication_style" and a new preference has the category "Communication style" with a similarity in the same-category strong band
- **THEN** the two SHALL merge as items of the same category

#### Scenario: Different categories stay different

- **WHEN** a stored item has the category "tooling" and a new item has the category "testing"
- **THEN** the cross-category thresholds SHALL apply

### Requirement: One category has one visible label

When a profile is saved, the system SHALL rewrite every category of preferences and patterns that shares a key to one visible label. An existing spelling without `_` or `-` SHALL take priority over spellings with those separators, regardless of item count. Among spellings with the same separator preference, the label SHALL be the spelling used by the most items across preferences and patterns. A tie SHALL go to a spelling that starts with a capital, then to the spelling seen first. The label SHALL then be tidied as described below. The rewrite SHALL cover learning, the manual edit on the Settings page, and the AI cleanup. It SHALL NOT change any other field, and it SHALL NOT merge, remove, or reorder items. Workflows have no category and SHALL be left alone.

#### Scenario: The most used spelling wins

- **WHEN** a profile holds 3 items with the category "Communication Style" and 2 items with "Communication style"
- **THEN** all 5 items SHALL have the category "Communication Style"

#### Scenario: A tie

- **WHEN** a profile holds 2 items with "communication_style" and 2 with "Communication style"
- **THEN** all 4 items SHALL have the category "Communication style"

#### Scenario: The stored spelling is sticky

- **WHEN** a profile holds 50 items with "Communication style" and the model returns one new item with "communication_style"
- **THEN** the new item SHALL be stored with the category "Communication style"

#### Scenario: A readable label survives a frequent slug

- **WHEN** a profile holds 5 preferences with "git-workflow" and one pattern with "Git workflow"
- **THEN** all 6 items SHALL use "Git workflow"
- **AND** a second canonicalisation SHALL change nothing

#### Scenario: An underscore spelling cannot displace a readable label

- **WHEN** a profile holds 5 patterns with "writing_standards" and one preference with "Writing standards"
- **THEN** all 6 items SHALL use "Writing standards"

#### Scenario: Hyphens without a readable alternative

- **WHEN** the only spelling for a key is "Anti-over-engineering"
- **THEN** that spelling SHALL stay unchanged

#### Scenario: A manual edit

- **WHEN** a user changes one item's category on the Settings page to "communication style" and other items in the profile use "Communication style"
- **THEN** the item SHALL be stored with the category "Communication style"

### Requirement: A label is tidied before it is stored

Before a label is stored, the system SHALL turn `_` into a space, collapse runs of spaces, and trim the ends. If the label holds no capital letter, the system SHALL capitalise its first letter. A label that already holds a capital letter SHALL keep its capitals. A blank label SHALL become "General". The category `explicit` SHALL stay `explicit`, and no other spelling of that key (such as "Explicit") SHALL replace it, whatever the counts.

#### Scenario: A slug

- **WHEN** the model returns the category "writing_standards"
- **THEN** the stored category SHALL be "Writing standards"

#### Scenario: An acronym

- **WHEN** the model returns the category "UI/UX"
- **THEN** the stored category SHALL be "UI/UX"

#### Scenario: A proper name

- **WHEN** the model returns the category "OpenSpec conventions"
- **THEN** the stored category SHALL be "OpenSpec conventions"

#### Scenario: A hyphen inside a longer label

- **WHEN** the model returns the category "Anti-over-engineering"
- **THEN** the stored category SHALL be "Anti-over-engineering"

#### Scenario: A blank category

- **WHEN** an item has an empty category
- **THEN** the stored category SHALL be "General"

#### Scenario: The explicit category

- **WHEN** an item has the category "explicit"
- **THEN** the stored category SHALL stay "explicit"

#### Scenario: A capitalised variant of the explicit category

- **WHEN** items hold both "explicit" and "Explicit", in any counts, across preferences and patterns
- **THEN** every one of those items SHALL be stored as "explicit"

### Requirement: The profile prompt lists the existing categories

When a profile already exists, the profile analysis prompt of every host SHALL list the visible labels of the existing preference and pattern categories and SHALL tell the model to use these exact names when an observation fits. The list SHALL show the item count of each label, put the most used first, and hold at most 40 labels for each type. When no profile exists, the prompt SHALL NOT hold a category list. Every host SHALL produce the same list text for the same profile.

#### Scenario: Spelling variants in one entry

- **WHEN** a profile holds 3 preferences with the category "communication_style" and 2 with "Communication style"
- **THEN** the list SHALL show one label with a count of 5

#### Scenario: A long category list

- **WHEN** a profile holds preferences in 100 distinct categories
- **THEN** the preference list SHALL show the 40 most used categories

#### Scenario: The first run

- **WHEN** no profile exists
- **THEN** the prompt SHALL hold no category list

#### Scenario: Hosts agree

- **WHEN** the same profile is analysed through the shared prompt and through the OpenCode prompt
- **THEN** both prompts SHALL hold the same category list text

### Requirement: A repair command applies the label rules to the stored profile

The command `om-memory-system profile-normalise-categories` SHALL apply the label rules to every stored preference and pattern. It SHALL print each rename (old label, new label, item count) and the number of distinct categories before and after. It SHALL change nothing without `--yes`, and nothing on `--dry-run`. A saved change SHALL appear in the profile changelog, so the previous state can be restored. A second run SHALL report 0 changes and SHALL NOT write a changelog entry.

#### Scenario: A preview

- **WHEN** a user runs the command without `--yes`
- **THEN** the command SHALL list the renames and the counts
- **AND** the stored profile SHALL stay unchanged

#### Scenario: A confirmed run

- **WHEN** a user runs the command with `--yes` on a profile with the categories "communication_style" and "Communication style"
- **THEN** both items SHALL have the same category
- **AND** the number of items SHALL stay the same
- **AND** the profile changelog SHALL hold a new entry for the change

#### Scenario: A second run

- **WHEN** a user runs the command with `--yes` again
- **THEN** the command SHALL report 0 changes
- **AND** it SHALL NOT write a new changelog entry
