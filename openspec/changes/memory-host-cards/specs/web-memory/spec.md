## MODIFIED Requirements

### Requirement: Memory has its own page and sidebar section

The application SHALL expose `/memory` as a top-level Memory page. Its sidebar children SHALL be Pi, OpenCode, Claude Code and Shared, which open `/memory/pi`, `/memory/opencode`, `/memory/claude-code` and `/memory/shared`. A child SHALL show a warning marker when its host card shows a warning. The Shared child SHALL list its five rows nested beneath it as a contents tree: Profile learning, Memory limits, Keyword matching, Reranker and Directory maps. Each SHALL link to `/memory/shared#<row>`, and following one SHALL open that row and scroll it into view. Settings SHALL NOT render the Memory sections. Project memories and User profile SHALL keep their existing routes and browsing functions.

#### Scenario: Opening Memory directly

- **WHEN** the user opens or reloads `/memory`
- **THEN** the Memory overview SHALL render and its sidebar entry SHALL be marked current
- **AND** the Pi, OpenCode, Claude Code and Shared views SHALL be reachable from the sidebar

#### Scenario: Using the Shared contents list

- **WHEN** the user selects Reranker under Shared in the sidebar from any Memory view
- **THEN** the application SHALL open `/memory/shared`, open the Reranker row and scroll it into view
- **AND** the mobile drawer SHALL close

#### Scenario: Settings after the move

- **WHEN** the user opens Settings
- **THEN** it SHALL retain model/API configuration, credentials, diagnostics, health, app configuration, and existing profile identity controls
- **AND** it SHALL contain no second copy of the Memory sections

#### Scenario: Desktop and mobile navigation

- **WHEN** the desktop sidebar is collapsed or the mobile drawer is used
- **THEN** Memory SHALL remain reachable with an accessible label
- **AND** its view navigation SHALL follow the existing focus and mobile-dismissal rules

### Requirement: Old memory-operation links reach the new sections

Links to old Settings anchors and old Memory section anchors SHALL open the view that now holds the section. Import, automatic import and host-specific unresolved-folder links SHALL open the matching host view, or the overview when no host is named. Profile learning, memory limits, keyword matching, reranker and directory-map links SHALL open the Shared view at the matching row. Following a link SHALL NOT save config or start model work.

#### Scenario: Saved links to the moved cards

- **WHEN** the user opens `/settings#settings-section-profile`, `/settings#settings-section-memory`, or `/settings#settings-section-directory-maps`
- **THEN** the application SHALL open `/memory/shared` and reveal the matching row after mount

#### Scenario: An old Memory section anchor

- **WHEN** the user opens `/memory#memory-section-reranker`
- **THEN** the application SHALL open `/memory/shared` and reveal the Reranker row

#### Scenario: An old import anchor

- **WHEN** the user opens `/settings#settings-section-import` or `/memory#memory-section-auto-import`
- **THEN** the application SHALL open the Memory overview

#### Scenario: A host-specific unresolved-folder link

- **WHEN** the user follows a Pi, OpenCode, or Claude Code unresolved-folder link from another page
- **THEN** Memory SHALL open that host's view with its group of sessions that need a folder focused

#### Scenario: An unrelated Settings link

- **WHEN** the user opens a Settings anchor that has not moved
- **THEN** the application SHALL keep Settings open and reveal that existing card

### Requirement: Hosts and project scope are visible choices

A host view's import SHALL cover that host only. The multi-host import opened by **Import all hosts** SHALL show individual Pi, OpenCode, and Claude Code choices, an All hosts shortcut, and Current project or All projects scope. Current project SHALL remain the default scope. A host selection SHALL NOT imply a wider project scope. Every selected host SHALL have its own source status and session selection. The multi-host import SHALL keep the user's host choices and scope after a reload of the page in the same browser.

#### Scenario: Choosing all histories for one project

- **WHEN** the user chooses All hosts and leaves Current project selected
- **THEN** the form SHALL include all three hosts for that project only

#### Scenario: Including every project

- **WHEN** the user chooses All hosts and All projects
- **THEN** the session lists SHALL cover the resolvable matching history of each selected host
- **AND** each host SHALL retain its own missing-folder count

#### Scenario: Restricting the hosts

- **WHEN** the user deselects a host
- **THEN** that host SHALL be excluded from the preview and the import
- **AND** its history SHALL remain unchanged

#### Scenario: Host choices survive a reload

- **WHEN** the user ticks OpenCode and Pi in the multi-host import and reloads the page
- **THEN** OpenCode and Pi SHALL still be ticked

## ADDED Requirements

### Requirement: Sidebar entries and page titles use normal capitals

In English, every sidebar entry and every page title SHALL use a capital first letter and lower case after it, as in "Memory", "Project memories", "User profile", "Chat", "Preferences", "Patterns" and "Workflows". The interface SHALL NOT force capitals with a style or store these labels in capitals. This SHALL NOT change the labels in other languages. The Memory views in the sidebar SHALL each show an icon: the host's avatar for Pi, OpenCode and Claude Code, and the Shared mark for Shared, all at the same size.

#### Scenario: English sidebar

- **WHEN** the language is English and the sidebar is open
- **THEN** the entries read Project memories, Chat, User profile, Memory and Settings
- **AND** no label has a capitals style applied

#### Scenario: Page title

- **WHEN** the user opens Memory or Settings in English
- **THEN** the page title reads "Memory" or "Settings" without a capitals style

#### Scenario: Shared in the sidebar

- **WHEN** the Memory entry is open
- **THEN** Pi, OpenCode, Claude Code and Shared each show an icon of the same size beside their name
