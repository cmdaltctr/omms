# Spec Delta

## ADDED Requirements

### Requirement: A running web cleanup can be minimised

While an AI Cleanup runs, the dialog SHALL show a Minimise button next to its close button. Minimise SHALL hide the dialog, SHALL NOT stop the job, and SHALL show a status pill at the top right of the window. Closing the dialog with the close button SHALL NOT show the pill.

#### Scenario: Minimise during a run

- **WHEN** the user selects Minimise while batch 5 of 14 runs
- **THEN** the dialog SHALL close
- **AND** the job SHALL keep running
- **AND** a pill at the top right SHALL show batch 5 of 14

#### Scenario: Close shows no pill

- **WHEN** the user closes the dialog with the close button while a job runs
- **THEN** no pill SHALL be shown
- **AND** the job SHALL keep running

### Requirement: The status pill follows the cleanup job

While the pill shows, the web app SHALL keep reading the job state. The pill SHALL show the batches done and the total while the job runs, a ready-to-review message when it is done, and a failure message in the error colour when it failed. Selecting the pill SHALL open the dialog on the screen for the current job state and SHALL remove the pill. When a read finds no job, the pill SHALL be removed.

#### Scenario: The pill follows progress

- **WHEN** the dialog is minimised and the job finishes batch 6 of 14
- **THEN** the pill SHALL show batch 6 of 14 without a page reload

#### Scenario: The job finishes while minimised

- **WHEN** the job finishes while the dialog is minimised
- **THEN** the pill SHALL say that the cleanup is ready to review
- **AND** selecting the pill SHALL open the review screen with that result

#### Scenario: The job fails while minimised

- **WHEN** every batch fails while the dialog is minimised
- **THEN** the pill SHALL say that the cleanup failed, in the error colour
- **AND** selecting the pill SHALL open the dialog with the error, Retry and Back

#### Scenario: The job is gone

- **WHEN** the dialog is minimised and a read of the job state finds no job
- **THEN** the pill SHALL be removed
