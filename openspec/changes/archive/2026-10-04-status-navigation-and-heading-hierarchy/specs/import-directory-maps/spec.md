# Host-specific directory navigation

## MODIFIED Requirements

### Requirement: Directory lists have compact expandable controls

Each host's Directory maps card SHALL initially collapse its unresolved rows. Its keyboard-accessible summary SHALL show the host, directory count, unresolved session count, and selected map count. Expanding a host SHALL show compact rows with individually expandable target controls. Collapsing a host or row SHALL retain unsaved targets and selections. Bulk actions and their results SHALL remain visible in the expanded host above the rows. Save maps SHALL remain accessible without expanding every row.

Host-specific unresolved-directory links SHALL reveal the matching host's disclosure, scroll its summary into view, and move focus to that summary. Navigation SHALL preserve all draft targets and selections, SHALL leave other hosts' disclosure states unchanged, and SHALL NOT automatically expand individual target editors. Existing general Directory maps anchors SHALL remain available. Repeating navigation to the same host after its disclosure was collapsed SHALL reveal it again. Navigation SHALL NOT save maps or start any import.

#### Scenario: Reviewing many missing folders

- **WHEN** the page contains unresolved directories for Pi, OpenCode, and Claude Code
- **THEN** each host list SHALL initially be collapsed
- **AND** expanding Pi SHALL reveal its rows without expanding the other hosts

#### Scenario: Keeping edits during collapse

- **WHEN** the user edits a target, selects its map, and collapses then expands the row or host
- **THEN** the edited target and selection SHALL remain unchanged

#### Scenario: Navigating to a host with unsaved edits

- **WHEN** the user has unsaved targets and selections and follows a Claude Code unresolved-directory link
- **THEN** the Claude Code disclosure SHALL open with focus on its summary
- **AND** all unsaved targets and selections SHALL remain unchanged
- **AND** other hosts and individual target editors SHALL keep their previous disclosure states

#### Scenario: Following the same host link again

- **WHEN** the user follows Pi's unresolved-directory link, collapses Pi's list, and follows the same link again
- **THEN** Pi's list SHALL open again and its summary SHALL receive focus

#### Scenario: A count no longer has matching rows

- **WHEN** the user follows a host's unresolved-directory link and its latest Directory maps list is empty
- **THEN** the page SHALL reveal that host's empty-state message and focus its summary
- **AND** it SHALL NOT choose a different host or invent directory rows
