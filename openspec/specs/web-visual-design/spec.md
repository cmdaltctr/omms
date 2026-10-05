# web-visual-design Specification

## Purpose

Give OMMS's existing web screens a consistent warm visual style while preserving their navigation, task flows, preferences, and data behaviour.

## Requirements

### Requirement: Existing screens use the selected warm themes

The web UI SHALL apply the canonical warm light and dark palette to the memory explorer, profile, settings, sidebar, menus, and dialogs. The light canvas SHALL be `#fdfcfa`, its main text `#393a34`, and its primary accent `#b35017`. The dark equivalents SHALL be `#120f0e`, `#c9c5ba`, and `#da7c47`. Selected navigation SHALL use a neutral tinted fill and readable main text, distinct from primary actions.

#### Scenario: Opening representative screens in each theme

- **WHEN** the user opens the explorer, profile, or settings in light or dark mode
- **THEN** the canvas, surfaces, text, borders, controls, and menus SHALL use the selected theme consistently
- **AND** selected navigation SHALL remain identifiable without using primary-action styling

### Requirement: UI typography retains readable technical content

The UI SHALL use system sans-serif typography for labels, headings, descriptions, and memory/profile prose. Code, commands, identifiers, and file paths SHALL retain JetBrains Mono with suitable glyph fallbacks. Browser zoom and text wrapping SHALL remain available. Memory prose SHALL retain its existing readable line height.

#### Scenario: Mixed prose and technical text

- **WHEN** a memory or settings row contains prose, a code block, and a long path
- **THEN** prose and UI labels SHALL render in system sans-serif
- **AND** code and technical values SHALL retain monospace typography without clipping surrounding text

#### Scenario: Arabic and Chinese typography

- **WHEN** the user selects Arabic or Chinese
- **THEN** the UI SHALL render the required glyphs with legible line height
- **AND** Arabic characters SHALL join correctly and Chinese labels SHALL wrap within narrow panels

### Requirement: Shared controls retain their contracts and visual states

Buttons and fields SHALL use consistent themed fills, corners, borders, typography, and visible keyboard focus. Primary buttons SHALL use pale accent tint, a subtle accent border, and readable accent labels. Neutral and destructive actions SHALL retain distinct appearances. Single-line default buttons and inputs SHALL target 36px height; small buttons SHALL target 32px and large buttons 40px. Extra-small controls SHALL remain suitable for dense desktop rows. Narrow-screen navigation controls SHALL provide at least 44px touch height. Disabled and invalid states SHALL remain recognisable, with meaningful status text or icons where present.

The controls SHALL preserve their existing variants, sizes, names, native form semantics, disabled rules, validation, callbacks, and select option/value contracts. Selection and focus styling SHALL remain distinct.

#### Scenario: Primary and destructive actions in settings

- **WHEN** the user hovers or focuses primary, neutral, and destructive actions in a settings section
- **THEN** each action SHALL retain its intended semantic appearance
- **AND** a general settings hover treatment SHALL NOT recolour a destructive action as a primary action

#### Scenario: Existing form submission

- **WHEN** the user submits an existing form or changes a settings control
- **THEN** the same values, validation, save timing, and callbacks SHALL apply
- **AND** a styling change SHALL NOT add a save step or cause an unintended submission

#### Scenario: Keyboard and disabled controls

- **WHEN** the user tabs through enabled controls alongside disabled or invalid controls
- **THEN** the focused element SHALL have a visible focus indicator
- **AND** disabled behaviour and existing validation messages SHALL remain unchanged

### Requirement: Visual adaptation preserves screen structure and task flows

The trial SHALL preserve routes, navigation targets, sidebar expanded/collapsed dimensions, app breakpoints, settings/profile section order and anchors, DOM reading order, features, visible wording and casing, helper text, warnings, save feedback, API calls, and destructive confirmations. Styling SHALL adapt the existing content within its current owners. A structural change or change to how a user completes a task SHALL require separate approval.

#### Scenario: Navigating after the visual change

- **WHEN** the user opens `/project-memories`, `/user-profile`, or `/settings`, collapses the sidebar, or selects a section anchor
- **THEN** navigation, dimensions, order, dismissal, and persisted sidebar choices SHALL match the existing behaviour
- **AND** the root route SHALL continue to resolve to the memory explorer

#### Scenario: Warnings and destructive confirmations

- **WHEN** a warning, validation message, save result, or destructive confirmation is displayed
- **THEN** its existing wording, visibility conditions, and required confirmation SHALL remain available
- **AND** explanations SHALL NOT be moved into tooltips or hidden to simplify the screen

### Requirement: Theme and language preferences retain compatibility

Theme and language changes SHALL keep the current preference keys, default dark theme, existing startup behaviour, and migration from legacy preferences. Current preferences SHALL take precedence over legacy values. Arabic SHALL retain document language and right-to-left direction. Language selection SHALL preserve the existing menu interactions and data refresh behaviour. Theme or language changes SHALL NOT reset the current route, sidebar state, selected items, or unsaved drafts beyond an existing intentional flow.

#### Scenario: Reloading stored preferences

- **WHEN** the user selects a theme and language and reloads the isolated UI
- **THEN** the saved theme, language, and document direction SHALL be restored
- **AND** existing sidebar collapse and settings-tree choices SHALL persist independently

#### Scenario: Adopting legacy preferences

- **WHEN** only legacy theme or language preferences exist
- **THEN** the existing migration SHALL adopt them
- **AND** a current preference SHALL win when both current and legacy values exist

#### Scenario: Switching presentation with an unsaved draft

- **WHEN** the theme or language changes while a multiline memory draft is open
- **THEN** the draft text, dialog state, selected memory, and route SHALL remain intact
- **AND** existing language-triggered refreshes SHALL continue without replacing the draft

### Requirement: Dialogs remain accessible in all supported directions

Dialogs SHALL retain their existing titles, form actions, Escape handling, focus trapping, and focus return. The shared close control SHALL use a translated accessible name in English, Chinese, and Arabic and logical end placement. Visible dialog wording SHALL otherwise remain unchanged. Long content SHALL remain scrollable and actions SHALL remain reachable in constrained layouts.

#### Scenario: Editing a memory with a keyboard

- **WHEN** the user opens the edit-memory dialog, enters a draft, tabs through its actions, and closes it
- **THEN** focus SHALL stay within the open dialog and return through the existing close flow
- **AND** Save and Cancel SHALL retain their existing callbacks and validation

#### Scenario: Arabic narrow dialog

- **WHEN** the edit-memory dialog is rendered in Arabic at a narrow width
- **THEN** the close control SHALL appear at the logical end and have an Arabic accessible name
- **AND** the textarea, title, and actions SHALL remain readable and reachable

### Requirement: Shared presentation remains legible across the visual matrix

Each representative screen SHALL remain usable in light and dark modes at English desktop, intermediate, and narrow widths, Arabic desktop and narrow widths, and Chinese narrow width. Normal text SHALL meet a 4.5:1 contrast target and large text a 3:1 target against the rendered background. Essential control boundaries and focus indicators SHALL meet a 3:1 target against adjacent colours. Touched controls and dialogs SHALL remain usable at 320px width and 200% browser zoom. Feedback transitions SHALL respect reduced motion and SHALL NOT shift layout on hover.

#### Scenario: Checking narrow translated screens

- **WHEN** settings, explorer, profile, dialogs, and sidebar menus are displayed at the specified narrow widths
- **THEN** translations SHALL remain readable without horizontal page overflow or clipped actions
- **AND** technical values SHALL retain their readable direction within Arabic content

#### Scenario: Checking focus, contrast, and reduced motion

- **WHEN** the user focuses or activates representative controls in either theme with reduced motion enabled
- **THEN** text, focus indicators, and essential boundaries SHALL meet the contrast targets
- **AND** feedback SHALL preserve labels and layout without unnecessary animation

### Requirement: Trial verification uses isolated synthetic data

The trial's verification environment SHALL load this worktree's frontend styles and SHALL use synthetic data or a separately authorised test store. The synthetic preview SHALL have no API route to the shared backend or production stores. Unhandled API requests SHALL fail closed. It SHALL NOT modify real settings, read private memories for screenshots, import history, call real models, or restart the shared backend. Evidence SHALL report each check as PASS, FAIL, NOT RUN, or BLOCKED.

#### Scenario: An unhandled preview request

- **WHEN** the synthetic preview receives an API request without a defined fixture
- **THEN** it SHALL return a fixture error without forwarding the request to the shared backend
- **AND** no real configuration, credentials, memory store, or history source SHALL be accessed

#### Scenario: Comparing the visual trial

- **WHEN** before/after screenshots are captured for the trial
- **THEN** their theme, language, width, and synthetic data state SHALL match
- **AND** the record SHALL identify the checkout supplying the styles and disclose any unverified matrix cases

### Requirement: Application headings have a semantic and visible hierarchy

Project memories, User profile, and Settings SHALL each have one application-provided H1 page title. Top-level application section or card titles SHALL use H2, and nested subsection or card titles SHALL use H3 where an H2 parent exists. Application-provided headings SHALL NOT skip levels. Visible titles that name sections SHALL use semantic headings rather than paragraph-like containers. Metadata-only labels, category badges, counts, and technical identifiers SHALL NOT become headings merely because they appear in cards.

At a standard 16px root size and 100% zoom, page titles SHALL render at 24px, section/card titles at 18px, subsection titles at 15px, and normal UI body text at 14px. These roles SHALL use relative sizing so browser font preferences and zoom remain effective. Headings SHALL have enough weight and spacing to distinguish them from body text. Existing helper text and code roles MAY retain their smaller sizes. The hierarchy SHALL use the current semantic theme colours and font families.

Stored memory text and its Markdown content SHALL remain unchanged. Application heading styles SHALL NOT override headings within rendered memory content. Dialog titles SHALL retain their accessible heading role and SHALL use the section-title size rather than inherit the larger page-title size. Routes, existing section anchors, section order, form actions, and unsaved drafts SHALL remain unchanged.

#### Scenario: Reading a Settings card

- **WHEN** the user opens Settings at the standard root size and 100% zoom
- **THEN** its page title SHALL be a 24px H1, each main card title an 18px H2, and nested section titles 15px H3
- **AND** normal card body text SHALL render at 14px

#### Scenario: Reading the Profile outline

- **WHEN** the user opens User profile with profile data
- **THEN** the profile identity and top-level Preferences, Patterns, and Workflows titles SHALL follow the page H1 without skipping H2
- **AND** titled cards nested within those sections SHALL use the next heading level where applicable

#### Scenario: Reading the memory explorer

- **WHEN** the user opens Project memories with memory cards
- **THEN** the page title and application-provided card or section titles SHALL follow the same heading hierarchy
- **AND** metadata and identifiers SHALL retain their existing roles
- **AND** headings inside stored memory Markdown SHALL retain their existing rendering

#### Scenario: Opening a dialog after the typography change

- **WHEN** the user opens an existing dialog
- **THEN** its accessible title SHALL use the 18px section-title role at the standard root size
- **AND** its actions, focus behaviour, and draft SHALL remain unchanged

#### Scenario: Translated headings on a narrow screen

- **WHEN** the user reads the changed screens in Chinese or Arabic at 390px or 320px width
- **THEN** long headings SHALL wrap without covering controls or causing horizontal page overflow
- **AND** Arabic direction and literal technical-path direction SHALL remain intact

#### Scenario: Zooming and changing presentation with a draft

- **WHEN** the user changes theme or language, or uses 200% browser zoom, with an unsaved draft open
- **THEN** heading hierarchy SHALL remain readable and actions SHALL remain reachable
- **AND** existing route, selection, and draft state SHALL remain intact
