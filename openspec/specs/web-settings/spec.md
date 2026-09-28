# web-settings Specification

## Purpose

Give users one page in the OMMS web UI to choose each host's capture model, control capture diagnostics, check system health, and run history imports, so these tasks no longer need config file edits or terminal commands.

## Requirements

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

The Settings page SHALL show one model card for OpenCode and one for Pi. Each card SHALL offer **Session model**, **Manual model**, and **External API**. Choosing Session model SHALL save the host's model as `inherit`. Choosing External API SHALL save the host's model as `external`. Choosing Manual model SHALL save the selected provider and model to that host's settings (`opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`). The manual picker SHALL list the host's signed-in models when the server can read them. Otherwise it SHALL accept a typed `provider/model` value and say that the list is not available. External API SHALL be selectable only when the external API is fully configured, and otherwise SHALL say which setting is missing. Each card SHALL show, read-only, the external API fallback and which model the live-model rule would choose now. The page SHALL NOT change the order of the live-model rule.

#### Scenario: Switching OpenCode to the session model

- **WHEN** the user chooses Session model on the OpenCode card and saves
- **THEN** the global config SHALL have `opencodeModel` set to `inherit`
- **AND** the next OpenCode capture SHALL use the session's model

#### Scenario: Pinning a manual Pi model

- **WHEN** the user picks provider `zai` and model `glm-5.3` on the Pi card and saves
- **THEN** the global config SHALL have `piProvider` `zai` and `piModel` `glm-5.3`
- **AND** the next Pi capture SHALL use that model

#### Scenario: Choosing the external API for Pi

- **WHEN** the external API is fully configured and the user chooses External API on the Pi card and saves
- **THEN** the global config SHALL have `piModel` set to `external`
- **AND** the next Pi capture SHALL call the external API

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
- **AND** the next capture attempt on either host SHALL write a trace entry, unless the project's config sets `captureTrace` to `false`

#### Scenario: A project has turned tracing off

- **WHEN** the global config turns tracing on and the current project's config sets `captureTrace` to `false`
- **THEN** capture attempts in that project SHALL NOT write trace entries
- **AND** the trace switch SHALL show that the project has tracing off

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

### Requirement: History imports can be run from a session list

The Settings page SHALL list Pi and OpenCode sessions from the chosen history source, defaulting to the current project. Each bounded page SHALL show selection keys, session IDs where present, dates, recorded project directories, and how each directory was resolved (recorded, mapped, worktree, or unresolved), without conversation content. The user SHALL be able to select individual sessions or all sessions matching the current source, scope, project, and directory maps across pages. The page SHALL show the selection count and run a dry-run preview of that exact selection before a real import.

The session list SHALL return a revision and a listing time. The revision SHALL be derived from the source identity, the matching options, and the sorted keys of the matching sessions. It SHALL NOT be derived from file sizes or modification times. A preview or import of an explicit selection SHALL be refused as stale when a selected session no longer exists or resolves to a different project. A preview or import of all matching sessions SHALL be refused as stale when the recomputed revision differs. Both SHALL import only user turns at or before the listing time, so the preview and the import read the same turns. The server SHALL keep no selection state between requests.

The session list and the importer SHALL resolve project directories with the same rules, in this order on both hosts: an exact directory map, then the recorded directory, then, for OpenCode only, the project worktree. Sessions that cannot be resolved SHALL NOT be assigned to any project. In current-project scope the page SHALL report how many sessions have missing directories and offer to show them.

Web selections SHALL reuse the shared importer and its ledger. CLI and slash-command flags SHALL keep their meaning, with two exceptions. A Pi `--root` that names one `.jsonl` file SHALL import that file. An OpenCode directory map SHALL take precedence over a recorded directory that still exists. The page SHALL NOT offer the single-session or maximum-sessions options; selection replaces them.

The main view SHALL show the host, session list, selection, preview, progress, cancellation, and final CLI-equivalent report. Advanced options SHALL hold scope, project, prompt date range, directory maps, source, skip memories, skip profile, profile batch size, and force. Date limits SHALL be labelled as inclusive **Prompt date from** and **Prompt date to**. They SHALL filter user turns within sessions, SHALL NOT filter the session list, and SHALL be interpreted in the browser's time zone. Empty limits SHALL include all turns. Turns that have no timestamp SHALL be included and counted in the preview. Only one preview or import SHALL run at a time. Imports SHALL stay idempotent and failed units retryable.

A real web import SHALL use an OpenCode-connected model or a complete saved external API. The page SHALL show the readiness of each model source before a job starts, and SHALL label it as configured, not tested. The server SHALL check readiness again when a job is requested. Pi authentication alone SHALL NOT be shown as a usable web-import model. When no model source is ready, the page SHALL explain why the real import is unavailable and SHALL still allow a dry run. When the Pi session reader cannot be loaded in the server process, Pi preview and import SHALL be unavailable, with that reason.

#### Scenario: Selecting sessions across pages

- **WHEN** the user chooses Select all matching sessions for the current project
- **THEN** the selection SHALL include matching sessions on every page, not only those visible
- **AND** the page SHALL show how many sessions will be previewed

#### Scenario: Previewing selected Pi sessions

- **WHEN** the user previews selected Pi sessions
- **THEN** the page SHALL show counts for that selection using the shared importer
- **AND** no model calls or memory-store writes SHALL happen

#### Scenario: A new session appears after listing

- **WHEN** a new session that matches the filter is created after the user lists sessions and chooses Select all matching sessions
- **THEN** the preview or import SHALL be refused as stale and the page SHALL ask the user to refresh
- **AND** the new session SHALL NOT be included silently

#### Scenario: A selected session gains turns after listing

- **WHEN** a selected session receives new turns after the listing
- **THEN** the selection SHALL NOT be refused as stale
- **AND** the preview and the import SHALL both exclude turns after the listing time
- **AND** the report SHALL state how many newer turns were held back
- **AND** a later import from a fresh listing SHALL import those turns

#### Scenario: Directory maps change the matching set

- **WHEN** the user changes the directory maps after listing
- **THEN** the page SHALL refresh the list before a preview or import can start

#### Scenario: Sessions with missing directories in the current project view

- **WHEN** some sessions record directories that no longer exist
- **THEN** the current-project view SHALL show how many there are and offer to show them in all-projects scope
- **AND** those sessions SHALL NOT be selectable until a directory map resolves them

#### Scenario: A directory map for a path that still exists

- **WHEN** an OpenCode session's recorded directory exists and a directory map names it
- **THEN** the session SHALL resolve to the map's target, as it does for Pi

#### Scenario: Date limits inside a session

- **WHEN** the user sets Prompt date from or Prompt date to
- **THEN** the inclusive limits SHALL apply to user turns within each selected session, using the start and end of each day in the browser's time zone
- **AND** an empty limit SHALL leave that side of the range unbounded
- **AND** the session list SHALL NOT be filtered by those dates

#### Scenario: No model is ready for a real import

- **WHEN** the web server has neither a connected OpenCode model nor a complete external API configuration
- **THEN** Preview SHALL remain available
- **AND** Import SHALL be disabled with a reason that tells the user what to configure
- **AND** a request to start an import SHALL be rejected with that reason before any job starts

#### Scenario: The external API key is missing in the server environment

- **WHEN** `memoryApiKey` is `env://NAME` and `NAME` is not set in the OpenCode process
- **THEN** readiness SHALL report the external API as missing its key, without showing a value

#### Scenario: The Pi session reader is unavailable

- **WHEN** the Pi SDK cannot be loaded in the OpenCode process
- **THEN** Pi preview and import SHALL be disabled with that reason

#### Scenario: Cancelling an import

- **WHEN** the user cancels a running import
- **THEN** the import SHALL stop after the current work unit, or earlier if it is still loading sessions or copying a snapshot
- **AND** the units not yet processed SHALL be imported by a later run

#### Scenario: A second import is started

- **WHEN** a preview or import is already running and the user starts another
- **THEN** the page SHALL refuse the second job and show the running one

#### Scenario: Rerunning after the CLI

- **WHEN** a session was already imported by the CLI
- **THEN** a page import SHALL skip the handled units and retain their ledger identities

#### Scenario: Importing a session again from a backup copy

- **WHEN** a Pi session already imported from its usual folder is selected from a backup copy of that file
- **THEN** its units SHALL be reported as already handled

### Requirement: Advanced source selection reads local history safely

Advanced options SHALL let the user choose a Pi sessions directory, one Pi `.jsonl` session file, or one OpenCode database file. On every bind, the page SHALL accept an absolute path, including a path on a mounted volume. Only on a loopback bind SHALL the page also offer a server-side browser. The browser SHALL start at the host's default location, list one folder at a time, show only subfolders and eligible files, and hide symlinked entries. The page SHALL NOT upload files from the browser.

The server SHALL reject relative paths, paths with `..` segments, and unsupported formats. It SHALL resolve accepted paths to their real path, so symlinks at or above the chosen path are allowed. Symlinked entries inside a Pi folder SHALL be skipped. It SHALL pin the source's real path, device, and inode, and SHALL refuse a job when these have changed since validation.

The source, session list, and job endpoints SHALL be JSON `POST`s under the Settings mutation rules, apart from the side-effect-free readiness check. They SHALL return metadata only, and errors SHALL NOT contain file contents. Pi header reads SHALL be bounded to the start of each file. A selected Pi file SHALL be validated and imported as one session. A Pi file whose loaded session ID differs from its header ID SHALL be reported as a load error. A selected OpenCode database SHALL first list its contained top-level sessions.

Original history files and OpenCode database, WAL, and shared-memory files SHALL remain unchanged. OpenCode snapshots SHALL be copied asynchronously and SHALL be cancellable. The server SHALL check free space before copying. A snapshot SHALL be reused by the listing, the preview, and the import of the same source. It SHALL be removed on success, failure, cancellation, expiry, and shutdown. When the web server starts, and before each new copy, snapshots left by processes that no longer run SHALL be removed.

#### Scenario: Choosing a Pi session file

- **WHEN** the user chooses one valid `.jsonl` session file
- **THEN** the page SHALL list that session only
- **AND** preview and import SHALL read only that file

#### Scenario: Choosing an OpenCode database

- **WHEN** the user chooses a file that passes the OpenCode V1 schema check
- **THEN** the page SHALL list its top-level sessions for selection
- **AND** it SHALL NOT treat the database as one session

#### Scenario: A large OpenCode source needs a snapshot

- **WHEN** the OpenCode database has a write-ahead log (WAL) and temporary space is less than the database size plus the WAL size plus a margin
- **THEN** the page SHALL show an actionable space error with the needed and available sizes before copying
- **AND** the original database, WAL, and shared-memory files SHALL remain unchanged

#### Scenario: Preview and import of a large database copy it once

- **WHEN** the user lists, previews, and imports sessions from one OpenCode database with a WAL
- **THEN** the database SHALL be copied at most once
- **AND** the web UI SHALL keep responding while the copy runs

#### Scenario: A snapshot is left behind by a crash

- **WHEN** OpenCode stops during an import and leaves a snapshot folder
- **THEN** the next web server start, or the next snapshot copy from the CLI, SHALL remove that folder
- **AND** it SHALL NOT remove a snapshot owned by a running process

#### Scenario: The default Pi folder is a symlink

- **WHEN** the Pi sessions folder, or one of its parent folders, is a symlink to another volume
- **THEN** the source SHALL be accepted through its real path

#### Scenario: A source path is unsupported

- **WHEN** the user enters a relative path, a path with `..` segments, or a file with the wrong format
- **THEN** the page SHALL refuse the source without returning its contents

#### Scenario: Browsing from the network

- **WHEN** the server is bound to a non-loopback host and a request asks to browse folders
- **THEN** the server SHALL refuse it and the page SHALL offer only the path field

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

Saving on the Settings page SHALL write only the changed keys to the global config file that OMMS is reading. When that file is the legacy `~/.config/opencode/opencode-mem.jsonc`, the first save SHALL create `~/.config/omms/omms.jsonc` as a copy of it, comments included, apply the change there, and tell the user that OMMS now reads the new file. The legacy file SHALL NOT be written. Saves SHALL run one at a time, and a save SHALL be rejected without writing when the file changed after the page read it. Saving SHALL keep comments, key order, and all other keys. It SHALL reject values that fail the same validation used at startup, and SHALL leave the file unchanged when it rejects them. Running OpenCode and Pi processes SHALL use the saved values from their next capture without a restart. The page SHALL NOT write project config files. It SHALL NOT read or show secret values; it SHALL show only whether a secret is set, its source type (literal, `env://`, or `file://`), and, for `env://` and `file://`, the variable name or file path. The only secret the page SHALL change is `memoryApiKey`, and only to an `env://` or `file://` reference, including one created by saving a pasted key to a private key file. It SHALL NOT save a literal key to the config.

#### Scenario: A commented config file is edited

- **WHEN** the user saves a new Pi model and the config file has comments
- **THEN** the comments and every other key SHALL remain unchanged

#### Scenario: The install still uses the legacy config file

- **WHEN** only `~/.config/opencode/opencode-mem.jsonc` exists and the user saves a new Pi model
- **THEN** `~/.config/omms/omms.jsonc` SHALL be created with every key and comment from the legacy file plus the new Pi model
- **AND** the legacy file SHALL be unchanged
- **AND** the page SHALL say that OMMS now reads `~/.config/omms/omms.jsonc`

#### Scenario: The file changed while the page was open

- **WHEN** the config file is edited by hand, or by another process, after the page read it and before the page saves
- **THEN** the save SHALL be rejected without writing
- **AND** the page SHALL reload the current settings and ask the user to save again

#### Scenario: An invalid value is saved

- **WHEN** the user saves a retention of `0` days
- **THEN** the save SHALL be rejected with the reason, and the file SHALL be unchanged

#### Scenario: The running host picks up a change

- **WHEN** Pi is running and the user saves a new Pi model on the page
- **THEN** Pi's next capture SHALL use the new model without a restart

#### Scenario: A secret is configured

- **WHEN** `memoryApiKey` is set to `env://OMMS_KEY`
- **THEN** the page SHALL show that the key is set from the environment variable `OMMS_KEY` and SHALL NOT show its value

#### Scenario: A literal key is submitted as a reference

- **WHEN** a request tries to save `memoryApiKey` as a value that is not an `env://` or `file://` reference
- **THEN** the save SHALL be rejected and the file SHALL be unchanged

### Requirement: Changes from the page are access-controlled

Every Settings endpoint that changes config, saves a key file, deletes trace files, validates or browses an import source, lists import sessions, starts, pauses, resumes, or cancels an import or backfill, or makes a model test call SHALL require a JSON request body and SHALL reject requests whose origin is not allowed by the web server's origin rules. When the web server is bound to a non-loopback host, these endpoints SHALL also require the existing API token or Basic Auth credentials. Turning `captureTrace` on, and saving a pasted key to a key file, SHALL be rejected when the server is bound to a non-loopback host without Basic Auth.

#### Scenario: A request from another website

- **WHEN** a page on another origin sends a request to change settings
- **THEN** the server SHALL reject it and the config SHALL be unchanged

#### Scenario: A cross-site request tries to list sessions

- **WHEN** Basic Auth is on and a page on another site sends a request to list sessions without a JSON body
- **THEN** the server SHALL reject it before reading any history source or copying any file

#### Scenario: Turning on tracing over the network

- **WHEN** the server is bound to `0.0.0.0` without Basic Auth and a request turns tracing on
- **THEN** the server SHALL reject it

#### Scenario: Saving a key over the network

- **WHEN** the server is bound to `0.0.0.0` without Basic Auth and a request saves a pasted key
- **THEN** the server SHALL reject it and write no key file

### Requirement: The page controls automatic import

The Settings page SHALL have an **Automatic import** section with a switch for `autoBackfill` and, for each host, a model choice for `opencodeBackfillModel` or `piBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model` chosen the same way as the host's capture model. For each host the section SHALL show the backfill state, including paused, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to the Directory maps section, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Run now, Pause, and Resume for each host. The counts SHALL refresh while a run is active. It SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running backfill after its current exchange. It SHALL say that automatic import makes model calls.

#### Scenario: Turning automatic import off

- **WHEN** the user turns off the Automatic import switch and saves while a Pi backfill runs
- **THEN** the global config SHALL have `autoBackfill` set to `false`
- **AND** the Pi backfill SHALL stop after its current exchange

#### Scenario: Choosing a backfill model for Pi

- **WHEN** the user picks provider `zai` and model `glm-5-turbo` for Pi's backfill and saves
- **THEN** the global config SHALL have `piBackfillModel` set to `zai/glm-5-turbo`
- **AND** `piProvider` and `piModel` SHALL be unchanged

#### Scenario: Choosing the external API for OpenCode's backfill

- **WHEN** the user chooses External API for OpenCode's backfill and saves
- **THEN** the global config SHALL have `opencodeBackfillModel` set to `external`

#### Scenario: Watching progress

- **WHEN** a backfill runs while the section is open
- **THEN** the counts, progress bar, percentage, and time left SHALL update without a page reload

### Requirement: The page controls starting the web app at login

The Settings page SHALL have a **Web app** section with a switch for `webServerAutoStart`, the login item's status (installed, not installed, or unsupported on this platform), and the terminal commands that start the web app or manage the item. It SHALL say that the change applies at the next Pi or OpenCode start, or right away with `om-memory-system web install` or `web uninstall`.

#### Scenario: Turning off start at login

- **WHEN** the user turns off the switch and saves
- **THEN** the global config SHALL have `webServerAutoStart` set to `false`
- **AND** the section SHALL say that the item is removed at the next host start

#### Scenario: Viewing the item status

- **WHEN** the login item is installed
- **THEN** the section SHALL show it as installed

### Requirement: The page configures the external API

The Settings page SHALL have an **External API** card that edits `memoryProvider`, `memoryApiUrl`, `memoryModel`, and `memoryApiKey` in the global config. The provider SHALL be chosen from the providers OMMS supports. The card SHALL offer three key sources:

- **Environment variable**: the user types a variable name, and the page saves `env://NAME`.
- **Key file**: the user types the path of an existing file, and the page saves `file://` with that path.
- **Save key to a private file**: the user pastes the key once. The server SHALL write it to a file under `~/.config/omms/secrets/`, create the folder if needed, restrict the file to the current user (mode `600` on macOS and Linux, a user-only access list on Windows), and save `file://` with that path. It SHALL replace an existing key file only after the user confirms.

The key value SHALL NOT be written to `omms.jsonc`, the log, the capture trace, or any response, and the page SHALL NOT show it after saving. The card SHALL show the saved key source type and reference, whether the key resolves in the web app's own process, and, for an environment variable, that a login web app does not see variables set only in a shell profile. A **Test** button SHALL make one small call with the saved settings and report success or an error with the key redacted.

#### Scenario: Using an environment variable

- **WHEN** the user chooses Environment variable, types `ZAI_API_KEY`, and saves
- **THEN** the global config SHALL have `memoryApiKey` set to `env://ZAI_API_KEY`

#### Scenario: Saving a pasted key

- **WHEN** the user pastes a key, chooses Save key to a private file, and saves
- **THEN** the key SHALL be written to a user-only file under `~/.config/omms/secrets/`
- **AND** `memoryApiKey` SHALL be set to `file://` with that path
- **AND** no response or log line SHALL contain the key

#### Scenario: The variable is missing in the login web app

- **WHEN** `memoryApiKey` is `env://ZAI_API_KEY` and the login web app's process has no such variable
- **THEN** the card SHALL say that the key does not resolve in the web app and suggest a key file

#### Scenario: Testing the endpoint

- **WHEN** the user clicks Test and the endpoint rejects the key
- **THEN** the card SHALL show the error with the key redacted
