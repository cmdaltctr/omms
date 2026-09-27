## Purpose

Give users one page in the OMMS web UI to choose each host's capture model, control capture diagnostics, check system health, and run history imports, so these tasks no longer need config file edits or terminal commands.

## ADDED Requirements

### Requirement: The sidebar opens a Settings page

The sidebar footer SHALL show a cogwheel button next to the language, theme, and GitHub buttons. It SHALL have an accessible label. Selecting it SHALL open the Settings page at `/settings`, and opening `/settings` directly SHALL show the same page.

#### Scenario: Opening settings from the sidebar

- **WHEN** the user selects the cogwheel button
- **THEN** the browser SHALL show the Settings page at `/settings`
- **AND** the button SHALL be marked as the current page

#### Scenario: Reloading the settings URL

- **WHEN** the user reloads `/settings`
- **THEN** the Settings page SHALL be shown, not the project memories view

### Requirement: Each host's capture model can be chosen on the page

The Settings page SHALL show one model card for OpenCode and one for Pi. Each card SHALL offer **Session model** and **Manual model**. Choosing Session model SHALL save the host's model as `inherit`. Choosing Manual model SHALL save the selected provider and model to that host's settings (`opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`). The manual picker SHALL list the host's signed-in models when the server can read them. Otherwise it SHALL accept a typed `provider/model` value and say that the list is not available. Each card SHALL show, read-only, the external API fallback and which model the live-model rule would choose now. The page SHALL NOT change the order of the live-model rule.

#### Scenario: Switching OpenCode to the session model

- **WHEN** the user chooses Session model on the OpenCode card and saves
- **THEN** the global config SHALL have `opencodeModel` set to `inherit`
- **AND** the next OpenCode capture SHALL use the session's model

#### Scenario: Pinning a manual Pi model

- **WHEN** the user picks provider `zai` and model `glm-5.3` on the Pi card and saves
- **THEN** the global config SHALL have `piProvider` `zai` and `piModel` `glm-5.3`
- **AND** the next Pi capture SHALL use that model

#### Scenario: The Pi model list is not available

- **WHEN** the server cannot load the Pi SDK
- **THEN** the Pi card SHALL accept a typed `provider/model` value
- **AND** it SHALL say that the list of signed-in models is not available

#### Scenario: A project config overrides the host model

- **WHEN** the current project's config sets the same model keys
- **THEN** the card SHALL say that the project value takes precedence for that project

### Requirement: Capture diagnostics are shown and controlled on the page

The Settings page SHALL show capture diagnostics for a selectable time range: save, skip, and failure counts and rates for each host and model, failure counts by reason code, and a table of recent attempts with their diagnostics fields. It SHALL provide controls for `captureTrace` and `captureTraceRetentionDays`, list existing trace files with their date and size, and let the user view or delete a trace file. Next to the trace switch, it SHALL warn that traces can contain conversation content.

#### Scenario: Viewing failure reasons

- **WHEN** the user opens the diagnostics section with the last 7 days selected
- **THEN** the page SHALL show failure counts for each reason code and each model in that range

#### Scenario: Turning tracing on

- **WHEN** the user turns on the trace switch and saves
- **THEN** the global config SHALL have `captureTrace` set to `true`
- **AND** the next capture attempt on either host SHALL write a trace entry

#### Scenario: Deleting a trace file

- **WHEN** the user deletes a trace file on the page
- **THEN** that file SHALL be removed and the list SHALL no longer show it

### Requirement: The page runs health checks

The Settings page SHALL run health checks on request and show each result as pass, warn, or fail with a short reason and no secret values. The checks SHALL cover: the global and project config files can be read and parsed; the memory store can be opened and queried; the embedding model can embed a test string; the web server binding and auth settings meet the security rules; the model each host would use for capture can be resolved; and the capture failure rate over the last 24 hours. The user MAY also start a test call for each resolved model, which sends a fixed short prompt with no conversation content.

#### Scenario: A healthy install

- **WHEN** every check passes
- **THEN** the page SHALL show every check as pass

#### Scenario: A high failure rate

- **WHEN** more than 20% of capture attempts in the last 24 hours failed
- **THEN** the capture check SHALL show warn, with the most common reason code

#### Scenario: A model test call fails

- **WHEN** the user tests a model and the call fails
- **THEN** the page SHALL show fail with the error, with API keys removed

### Requirement: History imports can be run from the page

The Settings page SHALL run the OpenCode history import and the Pi history backfill with the same options as the CLI and the same shared parser: dry run, scope, project, session, date range, maximum sessions, directory maps, history location, skip memories, skip profile, and profile batch size. A real import SHALL use the model chosen on the page: one of the OpenCode signed-in models, or the saved external API. The page SHALL offer a dry-run preview before a real import. While an import runs, the page SHALL show progress and SHALL let the user cancel. At the end, it SHALL show the same report as the CLI. Only one import SHALL run at a time. Imports started from the page SHALL use the same ledger as the CLI and slash commands, so reruns stay idempotent and failed units stay retryable.

#### Scenario: Previewing a Pi backfill

- **WHEN** the user runs a Pi backfill dry run for the current project
- **THEN** the page SHALL show the same counts the CLI dry run reports
- **AND** no model calls or store writes SHALL happen

#### Scenario: Cancelling an import

- **WHEN** the user cancels a running import
- **THEN** the import SHALL stop after the current work unit
- **AND** the units not yet processed SHALL be imported by a later run

#### Scenario: A second import is started

- **WHEN** an import is already running and the user starts another
- **THEN** the page SHALL refuse the second import and show the running one

#### Scenario: Rerunning after the CLI

- **WHEN** a session was already imported by the CLI
- **THEN** a page import SHALL skip it as already imported

### Requirement: The page shows the OMMS log

The Settings page SHALL show the most recent lines of the OMMS log file in a scrollable box, newest last, reading at most the last 256 KB of the file. It SHALL offer a filter that shows only `Capture attempt` records, a refresh action, and the full path of the log file with a copy action. The server SHALL return only lines from the OMMS log file at its configured path, and SHALL NOT accept a path from the request.

#### Scenario: Viewing recent capture attempts

- **WHEN** the user opens the log section and turns on the capture attempts filter
- **THEN** the box SHALL show the latest `Capture attempt` records, including their outcome and reason

#### Scenario: Copying the log path

- **WHEN** the user selects the copy action next to the log path
- **THEN** the full path of the log file SHALL be copied to the clipboard

#### Scenario: The log file does not exist yet

- **WHEN** the log file does not exist
- **THEN** the box SHALL say that no log has been written yet and still show the path

### Requirement: Settings are saved safely to the global config

Saving on the Settings page SHALL write only the changed keys to the global config file that OMMS is reading. When that file is the legacy `~/.config/opencode/opencode-mem.jsonc`, the first save SHALL create `~/.config/omms/omms.jsonc` as a copy of it, comments included, apply the change there, and tell the user that OMMS now reads the new file. The legacy file SHALL NOT be written. Saving SHALL keep comments, key order, and all other keys. It SHALL reject values that fail the same validation used at startup, and SHALL leave the file unchanged when it rejects them. Running OpenCode and Pi processes SHALL use the saved values from their next capture without a restart. The page SHALL NOT write project config files. It SHALL NOT read, show, or change secret values; it SHALL show only whether a secret is set and its source type (literal, `env://`, or `file://`).

#### Scenario: A commented config file is edited

- **WHEN** the user saves a new Pi model and the config file has comments
- **THEN** the comments and every other key SHALL remain unchanged

#### Scenario: The install still uses the legacy config file

- **WHEN** only `~/.config/opencode/opencode-mem.jsonc` exists and the user saves a new Pi model
- **THEN** `~/.config/omms/omms.jsonc` SHALL be created with every key and comment from the legacy file plus the new Pi model
- **AND** the legacy file SHALL be unchanged
- **AND** the page SHALL say that OMMS now reads `~/.config/omms/omms.jsonc`

#### Scenario: An invalid value is saved

- **WHEN** the user saves a retention of `0` days
- **THEN** the save SHALL be rejected with the reason, and the file SHALL be unchanged

#### Scenario: The running host picks up a change

- **WHEN** Pi is running and the user saves a new Pi model on the page
- **THEN** Pi's next capture SHALL use the new model without a restart

#### Scenario: A secret is configured

- **WHEN** `memoryApiKey` is set to `env://OMMS_KEY`
- **THEN** the page SHALL show that the key is set from an environment variable and SHALL NOT show its value

### Requirement: Changes from the page are access-controlled

Every Settings endpoint that changes config, deletes trace files, starts or cancels an import, or makes a model test call SHALL reject requests whose origin is not allowed by the web server's origin rules. When the web server is bound to a non-loopback host, these endpoints SHALL also require the existing API token or Basic Auth credentials. Turning `captureTrace` on SHALL be rejected when the server is bound to a non-loopback host without Basic Auth.

#### Scenario: A request from another website

- **WHEN** a page on another origin sends a request to change settings
- **THEN** the server SHALL reject it and the config SHALL be unchanged

#### Scenario: Turning on tracing over the network

- **WHEN** the server is bound to `0.0.0.0` without Basic Auth and a request turns tracing on
- **THEN** the server SHALL reject it
