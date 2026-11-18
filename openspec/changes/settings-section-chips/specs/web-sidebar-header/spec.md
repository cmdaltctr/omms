## MODIFIED Requirements

### Requirement: The sidebar header shows the product name and the running version

The sidebar header SHALL show the product name `OMMS` in every supported language. The name SHALL use the section-title size (1.125rem), semibold weight and the normal text colour, as in OMRS. After the name, the header SHALL show the version that `GET /api/web/status` reports, with a `v` prefix, at 0.8125rem in the muted text colour. The header SHALL read the version from the same status calls that the power button uses and SHALL NOT add a separate request schedule. When a status call reports a different version, the header SHALL show the new version without a page reload. While no status call has answered, the header SHALL show the name without a version. On a narrow screen, the top bar SHALL show the same name and version. When the desktop sidebar is collapsed, the header SHALL hide the name and the version.

#### Scenario: The page opens

- **WHEN** the web app 4.9.0 serves the page and the status call answers
- **THEN** the sidebar header SHALL show `OMMS` at the section-title size, semibold, in the normal text colour
- **AND** `v4.9.0` SHALL follow at 0.8125rem in the muted text colour

#### Scenario: A restart brings a newer copy

- **WHEN** the page shows `v4.9.0` and the web app restarts onto 4.10.0
- **THEN** the header SHALL show `v4.10.0` after the next status call, without a page reload

#### Scenario: The status call fails

- **WHEN** the page opens and no status call has answered
- **THEN** the header SHALL show `OMMS` without a version

#### Scenario: The sidebar is collapsed on a desktop

- **WHEN** the user collapses the desktop sidebar
- **THEN** the header SHALL show only the icon

#### Scenario: Another language is selected

- **WHEN** the user selects Chinese or Arabic
- **THEN** the header SHALL show `OMMS` and the version unchanged
