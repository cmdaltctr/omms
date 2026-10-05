# Directory map controls

## ADDED Requirements

### Requirement: Directory lists have compact expandable controls

Each host's Directory maps card SHALL initially collapse its unresolved rows. Its keyboard-accessible summary SHALL show the host, directory count, unresolved session count, and selected map count. Expanding a host SHALL show compact rows with individually expandable target controls. Collapsing a host or row SHALL retain unsaved targets and selections. Bulk actions and their results SHALL remain visible in the expanded host above the rows. Save maps SHALL remain accessible without expanding every row.

#### Scenario: Reviewing many missing folders

- **WHEN** the page contains unresolved directories for Pi, OpenCode, and Claude Code
- **THEN** each host list SHALL initially be collapsed
- **AND** expanding Pi SHALL reveal its rows without expanding the other hosts

#### Scenario: Keeping edits during collapse

- **WHEN** the user edits a target, selects its map, and collapses then expands the row or host
- **THEN** the edited target and selection SHALL remain unchanged

### Requirement: Users can select maps in bulk per host

Each expanded host SHALL offer Select all with targets and Clear selection. Select all with targets SHALL select rows with a recorded source directory and a non-empty target, using the edited target when present and otherwise the suggested target. It SHALL NOT invent targets, overwrite edits, or select sessions with no recorded directory. Clear selection SHALL deselect that host's rows without clearing target text. Neither action SHALL save config or start an import. Selection of a source shared across hosts SHALL be consistent with the single saved mapping for that source. Existing target validation and import resolution rules SHALL remain unchanged.

#### Scenario: Selecting available targets

- **WHEN** a host has a suggested target, a manually entered target, an empty target, and a No directory recorded entry
- **THEN** Select all with targets SHALL select only the suggested and manually entered targets
- **AND** config SHALL remain unchanged until Save maps

#### Scenario: Clearing selected maps

- **WHEN** the user presses Clear selection
- **THEN** the host's map selections SHALL be cleared while their target text remains

### Requirement: Suggestion actions explain when no work is done

Smart resolve SHALL display an accessible result beside its button with counts for newly selected suggestions, rows already selected, and mappable rows without suggestions. When no suggestion can be selected, it SHALL explain whether rows are already selected or need a manually chosen target. It SHALL preserve accepted choices and SHALL NOT save. The result SHALL direct the user to review selections and press Save maps when any maps are selected.

#### Scenario: No suggested targets exist

- **WHEN** the user presses Smart resolve and no mappable row has a suggestion
- **THEN** the visible result SHALL say that no suggested targets were selected
- **AND** it SHALL explain that the user must choose targets for rows without suggestions

#### Scenario: Suggestions are already selected

- **WHEN** the user presses Smart resolve after all suggested rows are selected
- **THEN** the result SHALL report the already selected rows and explain that Save maps is still required
