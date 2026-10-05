# Application heading hierarchy

## ADDED Requirements

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
