## MODIFIED Requirements

### Requirement: Capture diagnostics are shown and controlled on the page

The Settings page SHALL show capture diagnostics for a selectable time range: save, skip, and failure counts and rates for each host and model, failure counts by reason code, and a table of recent attempts with their diagnostics fields. It SHALL provide controls for `captureTrace`, `captureTraceRetentionDays`, and `captureRetryRetentionHours`, show the number of turns waiting in the capture retry queue for each host with a **Retry now** button for each host, list existing trace files with their date and size, and let the user view or delete a trace file. Next to the trace switch, it SHALL warn that traces can contain conversation content.

#### Scenario: Viewing failure reasons

- **WHEN** the user opens the diagnostics section with the last 7 days selected
- **THEN** the page SHALL show failure counts for each reason code and each model in that range

#### Scenario: Turning tracing on

- **WHEN** the user turns on the trace switch and saves
- **THEN** the global config SHALL have `captureTrace` set to `true`
- **AND** the next capture attempt on either host SHALL write a trace entry, unless the project's config sets `captureTrace` to `false`

#### Scenario: A project has turned tracing off

- **WHEN** the global config turns tracing on and the current project's config sets `captureTrace` to `false`
- **THEN** capture attempts in that project SHALL NOT write trace entries
- **AND** the trace switch SHALL show that the project has tracing off

#### Scenario: Deleting a trace file

- **WHEN** the user deletes a trace file on the page
- **THEN** that file SHALL be removed and the list SHALL no longer show it

#### Scenario: Changing how long failed turns are kept

- **WHEN** the user sets retry retention to 24 hours and saves
- **THEN** the global config SHALL have `captureRetryRetentionHours` set to `24`
- **AND** running hosts SHALL use 24 hours from their next retry pass or cleanup run

#### Scenario: Seeing queued turns

- **WHEN** two Pi turns and no OpenCode turns wait in the retry queue
- **THEN** the diagnostics section SHALL show 2 queued turns for Pi and 0 for OpenCode

#### Scenario: Retry now while the host runs in the server's process

- **WHEN** two Pi turns wait, the Pi process runs the Web UI server, the API is reachable, and the user presses **Retry now** for Pi
- **THEN** both turns SHALL be retried at once
- **AND** the Pi queued count SHALL show 0 after the retries finish

#### Scenario: Retry now for a host in another process

- **WHEN** OpenCode turns wait and OpenCode does not run in the Web UI server's process, and the user presses **Retry now** for OpenCode
- **THEN** the page SHALL say the turns will retry at OpenCode's next session start
- **AND** those turns SHALL be due at that time regardless of their wait schedule

#### Scenario: Turning the queue off on the page

- **WHEN** turns wait in the queue and the user sets retry retention to 0 and saves
- **THEN** the queued counts SHALL show 0 for both hosts
- **AND** the **Retry now** buttons SHALL be disabled
