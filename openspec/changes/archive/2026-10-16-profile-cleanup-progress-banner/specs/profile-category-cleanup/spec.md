## ADDED Requirements

### Requirement: The Profile page shows the state of a cleanup preview

The web app SHALL show a banner on the Profile page while the user's cleanup preview job exists. The banner SHALL show the job's state: running with its progress, ready with the number of groups, or failed with the error. The banner SHALL offer a button that opens the review dialog. The banner SHALL only read the job state. It SHALL NOT start a job or call the profile model.

#### Scenario: Running preview with the dialog closed

- **WHEN** the job is checking groups and the user has closed the review dialog
- **THEN** the banner SHALL show the batches done and the total
- **AND** SHALL update without a page reload
- **AND** its button SHALL open the review dialog

#### Scenario: Grouping names

- **WHEN** the job is grouping category names
- **THEN** the banner SHALL say that names are being grouped
- **AND** SHALL NOT show a batch count

#### Scenario: Preview finishes

- **WHEN** the job finishes while the user is on the Profile page
- **THEN** the banner SHALL change to say that a preview is ready, with the number of groups
- **AND** SHALL stop asking the web app for the job state

#### Scenario: Preview fails

- **WHEN** the job fails
- **THEN** the banner SHALL show the error
- **AND** its button SHALL open the review dialog, where a new preview can be built

#### Scenario: No job

- **WHEN** no job exists, after a restart of the web app or after Apply or Undo
- **THEN** the Profile page SHALL show no banner

#### Scenario: Dialog open

- **WHEN** the review dialog is open
- **THEN** the banner SHALL be hidden
- **AND** SHALL show the current job state when the dialog closes

#### Scenario: The status request fails

- **WHEN** the request for the job state fails, for example because the web app stopped
- **THEN** the Profile page SHALL show no banner
- **AND** SHALL show no error message
- **AND** SHALL NOT ask again until the page opens again or the review dialog closes

#### Scenario: Leaving the Profile page

- **WHEN** the user moves from the Profile page to another page while a job runs
- **THEN** the web app SHALL stop asking for the job state
- **AND** the job SHALL continue on the server

#### Scenario: Opening the page starts nothing

- **WHEN** the user opens the Profile page and no job exists
- **THEN** the system SHALL NOT start a job
- **AND** SHALL make no model call
