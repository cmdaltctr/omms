# web-memory Specification

## Purpose

Give memory operations a dedicated page that explains what each action reads and updates, so users can import history or learn a profile without decoding technical skip flags.

## Requirements

### Requirement: Memory has its own page and sidebar section

The application SHALL expose `/memory` as a top-level Memory page. Its sidebar children SHALL be Import chat history, Automatic import, Profile learning, Memory limits, and Resolve missing project folders. Settings SHALL no longer render those sections. Project memories and User profile SHALL keep their existing routes and browsing functions.

#### Scenario: Opening Memory directly

- **WHEN** the user opens or reloads `/memory`
- **THEN** the Memory page SHALL render and its sidebar entry SHALL be marked current
- **AND** the five Memory sections SHALL be reachable from the sidebar

#### Scenario: Settings after the move

- **WHEN** the user opens Settings
- **THEN** it SHALL retain model/API configuration, credentials, diagnostics, health, app configuration, and existing profile identity controls
- **AND** it SHALL contain no second copy of the moved Memory sections

#### Scenario: Desktop and mobile navigation

- **WHEN** the desktop sidebar is collapsed or the mobile drawer is used
- **THEN** Memory SHALL remain reachable with an accessible label
- **AND** its section navigation SHALL follow the existing focus and mobile-dismissal rules

### Requirement: Old memory-operation links reach the new sections

Links to moved Settings anchors SHALL resolve to the corresponding section on `/memory`. This SHALL cover import, automatic import, profile learning, memory limits, directory maps, and host-specific unresolved-folder links. Following a link SHALL not save config or start model work.

#### Scenario: Saved links to the moved cards

- **WHEN** the user opens `/settings#settings-section-import`, `/settings#settings-section-auto-import`, `/settings#settings-section-profile`, `/settings#settings-section-memory`, or `/settings#settings-section-directory-maps`
- **THEN** the application SHALL navigate to the corresponding Memory section and reveal it after mount

#### Scenario: A host-specific unresolved-folder link

- **WHEN** the user follows a Pi, OpenCode, or Claude Code unresolved-folder link from another page
- **THEN** Memory SHALL open Resolve missing project folders with the matching host disclosure focused
- **AND** existing drafts and other host disclosures SHALL follow the directory-map preservation rules

#### Scenario: An unrelated Settings link

- **WHEN** the user opens a Settings anchor that has not moved
- **THEN** the application SHALL keep Settings open and reveal that existing card

### Requirement: The page explains the two import outputs

Import chat history SHALL explain that conversations populate project memories and user prompts populate a user profile. It SHALL name the profile parts as preferences, patterns, and workflows. It SHALL link to the existing browsing pages and explain that profiles follow the existing user identity rules.

#### Scenario: Understanding the outputs before importing

- **WHEN** the user opens Import chat history
- **THEN** the visible explanation SHALL distinguish project facts from personal preferences, recurring patterns, and workflow steps
- **AND** reading it SHALL require neither a tooltip nor Advanced options

### Requirement: Imports use positive output choices

The import form SHALL show Project memories and User profile choices, both selected by default. User profile SHALL name preferences, patterns, and workflows beside it. A deselected output SHALL be skipped. With neither selected, Preview and Start SHALL be disabled and requests SHALL be rejected. CLI skip flags SHALL retain their meanings.

#### Scenario: Default import

- **WHEN** the user opens a new import form
- **THEN** both outputs SHALL be selected
- **AND** the preview SHALL state that both will be populated

#### Scenario: Profile-only import

- **WHEN** only User profile is selected
- **THEN** the import SHALL analyse user prompts without extracting project memories
- **AND** stored project memories SHALL remain unchanged

#### Scenario: Memory-only import

- **WHEN** only Project memories is selected
- **THEN** the import SHALL extract project memories and skip its profile step

#### Scenario: No output selected

- **WHEN** the user deselects both outputs or submits both corresponding skip options
- **THEN** no job SHALL start
- **AND** an accessible message SHALL ask the user to choose an output

### Requirement: Hosts and project scope are visible choices

The main import form SHALL show individual Pi, OpenCode, and Claude Code choices, an All hosts shortcut, and Current project or All projects scope. Current project SHALL remain the default scope. A host selection SHALL not imply a wider project scope. Every selected host SHALL have its own source status and session selection.

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

### Requirement: Import preview explains the work before it starts

The form SHALL require a successful preview of the current selection and options before enabling a real import. Preview SHALL show per-host and combined session counts, memory work, profile prompts, unresolved sessions, and source/model blockers. Profile analysis-call estimates SHALL exclude trivial prompts and SHALL not claim to include every matching, retry, or deduplication call.

#### Scenario: Changing an option after preview

- **WHEN** the user changes hosts, source, sessions, scope, dates, output choices, re-analysis, batch size, maps, or model choice after preview
- **THEN** the old preview SHALL cease to authorise Start
- **AND** the page SHALL ask for another preview

#### Scenario: Confirming a paid import

- **WHEN** a valid preview is ready and the user starts a real import
- **THEN** the confirmation SHALL name the hosts, scope, outputs, configured model sources, and work counts
- **AND** it SHALL warn that the run makes model calls

#### Scenario: No pending work

- **WHEN** a preview finds no pending work for a selected host
- **THEN** its row SHALL say that there is no work to process
- **AND** it SHALL not be reported as an unavailable or failed host

### Requirement: Profile learning distinguishes backlog analysis from history re-analysis

Profile learning SHALL visibly distinguish Analyse waiting prompts from Re-analyse chat history. The first action SHALL read waiting prompts inside OMMS. The second SHALL open the history import flow with User profile selected, Project memories deselected, and force enabled. It SHALL preserve the existing profile and explain that matching can merge findings.

#### Scenario: Analysing the backlog

- **WHEN** the user chooses Analyse waiting prompts
- **THEN** the existing catch-up confirmation and run SHALL process only prompts still waiting for profile learning
- **AND** no host history SHALL be re-listed by that action

#### Scenario: Recovering findings from history

- **WHEN** the user chooses Re-analyse chat history
- **THEN** the page SHALL offer host and project scope choices with a forced profile-only import preset
- **AND** it SHALL require preview and confirmation before starting
- **AND** project memories SHALL remain unchanged

#### Scenario: Re-analysis is not a profile reset

- **WHEN** a forced profile-only run succeeds
- **THEN** its findings SHALL use the existing merge and retention rules
- **AND** the page SHALL not promise a larger workflow count or a freshly empty profile

#### Scenario: The prompts were already forcibly re-analysed

- **WHEN** the forced replay ledger already records selected prompts as rebuilt
- **THEN** preview SHALL show them as already handled
- **AND** the page SHALL explain the existing once-per-prompt forced replay rule

### Requirement: Automatic import explains its existing boundaries

Automatic import SHALL explain that it imports older conversations in the background when a host starts, populating memories and profile input. It SHALL show that the first backfill fixes a cutoff and later turns rely on live capture. Its existing enable switch, model choices, per-host actions, and operational states SHALL remain available.

#### Scenario: Reading automatic import

- **WHEN** the user opens Automatic import
- **THEN** the visible explanation SHALL name both outputs and the fixed-cutoff behaviour
- **AND** it SHALL warn that automatic import makes model calls

### Requirement: Technical controls remain available without hiding basic choices

Source overrides, inclusive prompt dates, profile batch size, and per-run map overrides SHALL remain in Advanced options. Hosts, project scope, output choices, preview, progress, and the normal import action SHALL be visible outside it. Existing source safety and date semantics SHALL remain unchanged.

#### Scenario: A normal import without advanced controls

- **WHEN** Advanced options is collapsed
- **THEN** the user SHALL be able to choose hosts, scope, outputs, and sessions, then preview and confirm an import

#### Scenario: A source from another volume

- **WHEN** the user opens Advanced options
- **THEN** each selected host SHALL offer its supported source override with the existing path validation and browsing restrictions

### Requirement: Memory controls remain usable in every supported language

New Memory headings, explanations, actions, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic. Theme and language changes SHALL preserve in-page drafts and the active job. Paths and model identifiers SHALL remain readable left-to-right. Controls SHALL remain usable at narrow widths and 200% zoom.

#### Scenario: Arabic with a selected import

- **WHEN** the user changes the page language to Arabic while an import draft is open
- **THEN** its host and output choices SHALL remain selected
- **AND** the page SHALL use right-to-left layout with readable technical paths

#### Scenario: Narrow layout and zoom

- **WHEN** the Memory page is viewed at 320px width or 200% zoom
- **THEN** its actions and feedback SHALL remain reachable without whole-page horizontal overflow
- **AND** wide tables SHALL scroll within their sections
