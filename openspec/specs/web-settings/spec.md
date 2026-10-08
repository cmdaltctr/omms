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

The Settings page SHALL show one model card for OpenCode and one for Pi. Each card SHALL offer **Session model**, **Manual model**, and **External API**. Choosing Session model SHALL save the host's model as `inherit`. Choosing External API SHALL save the host's model as `external`. Choosing Manual model SHALL save the selected provider and model to that host's settings (`opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`). The manual picker SHALL list the host's signed-in models when the server can read them. Otherwise it SHALL accept a typed `provider/model` value and SHALL show the server's reason for the missing list. Each reason SHALL say what happened and what the user can do next, in the page's language. The Automatic import section SHALL show the same reason when it offers a manual model for that host. External API SHALL be selectable only when the external API is fully configured, and otherwise SHALL say which setting is missing. Each card SHALL show, read-only, the external API fallback and which model the live-model rule would choose now. The page SHALL NOT change the order of the live-model rule.

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
- **AND** it SHALL say that OMMS could not read Pi's model list and that the user can type the model as `provider/model`

#### Scenario: Pi has no signed-in models

- **WHEN** the server loads the Pi SDK and no Pi provider is signed in
- **THEN** the Pi card SHALL say that Pi has no signed-in models
- **AND** it SHALL tell the user to sign in to a provider in Pi and reload the page

#### Scenario: OpenCode is not found

- **WHEN** no OpenCode session serves the web app and the server cannot find the `opencode` program
- **THEN** the OpenCode card SHALL accept a typed `provider/model` value
- **AND** it SHALL say that OMMS could not find OpenCode on this computer
- **AND** it SHALL tell the user to type the model as `provider/model`, or to open an OpenCode session and reload the page

#### Scenario: OpenCode does not start in time

- **WHEN** the private OpenCode server does not start or does not send its list within the time limit
- **THEN** the OpenCode card SHALL say that OpenCode took too long to send its model list
- **AND** it SHALL tell the user to reload the page or type the model as `provider/model`

#### Scenario: OpenCode has no signed-in models

- **WHEN** OpenCode answers with an empty model list after the time limit
- **THEN** the OpenCode card SHALL say that OpenCode has no signed-in models
- **AND** it SHALL tell the user to run `opencode auth login` and reload the page

#### Scenario: OpenCode sends a reply OMMS cannot read

- **WHEN** the private OpenCode server answers in a format OMMS does not know
- **THEN** the OpenCode card SHALL say that this OpenCode version sent a model list OMMS cannot read
- **AND** it SHALL tell the user to type the model as `provider/model`

#### Scenario: The reason in the Automatic import section

- **WHEN** the OpenCode model list is not available and the user opens the Automatic import section
- **THEN** the OpenCode backfill model choice SHALL show the same reason as the OpenCode model card

#### Scenario: The reason in another language

- **WHEN** the page language is Chinese or Arabic and a model list is not available
- **THEN** the reason SHALL be shown in that language

#### Scenario: A project config overrides the host model

- **WHEN** the current project's config sets the same model keys
- **THEN** the card SHALL say that the project value takes precedence for that project

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

The Memory page SHALL list Pi, OpenCode, and Claude Code sessions from each chosen history source, defaulting to the current project. Each bounded page SHALL show selection keys, session IDs where present, dates, recorded project directories, and how each directory was resolved (recorded, mapped, worktree, or unresolved), without conversation content. The user SHALL be able to select individual sessions or all sessions matching the current source, scope, project, and directory maps across pages. The page SHALL show the selection count and run a dry-run preview of that exact selection before a real import. Selecting multiple hosts SHALL retain separate pinned selections and follow the multi-host-import capability.

The session list SHALL return a revision and a listing time. The revision SHALL be derived from the source identity, the matching options, and the sorted keys of the matching sessions. It SHALL NOT be derived from file sizes or modification times. A preview or import of an explicit selection SHALL be refused as stale when a selected session no longer exists or resolves to a different project. A preview or import of all matching sessions SHALL be refused as stale when the recomputed revision differs. Both SHALL import only user turns at or before the listing time, so the preview and the import read the same turns. The server SHALL keep no selection state between requests.

The session list and the importer SHALL resolve project directories with the same rules, in this order on all hosts: an exact directory map, then the recorded directory, then, for OpenCode only, the project worktree. Sessions that cannot be resolved SHALL NOT be assigned to any project. In current-project scope the page SHALL report how many sessions have missing directories and offer to show them.

Web selections SHALL reuse the shared importer and its ledger. CLI and slash-command flags SHALL keep their meaning, with two exceptions. A Pi `--root` that names one `.jsonl` file SHALL import that file. An OpenCode directory map SHALL take precedence over a recorded directory that still exists. The page SHALL NOT offer the single-session or maximum-sessions options; selection replaces them.

The main view SHALL show host choices, project scope, positive Project memories and User profile choices, session lists, selections, preview, progress, cancellation, and final CLI-equivalent reports. User profile SHALL identify preferences, patterns, and workflows. Both outputs SHALL be selected by default, and choosing neither SHALL be refused. Advanced options SHALL hold project path details, prompt date range, directory maps, source overrides, profile batch size, and re-analysis. Date limits SHALL be labelled as inclusive **Prompt date from** and **Prompt date to**. They SHALL filter user turns within sessions, SHALL NOT filter the session list, and SHALL be interpreted in the browser's time zone. Empty limits SHALL include all turns. Turns that have no timestamp SHALL be included and counted in the preview. Only one preview or import SHALL run at a time, including a grouped import. Imports SHALL stay idempotent and failed units retryable.

A real web import SHALL use an OpenCode-connected model or a complete saved external API under each host's existing rules; Claude Code SHALL use the external API only. The page SHALL show the readiness of each model source before a job starts, and SHALL label it as configured, not tested. The server SHALL check readiness again when a job is requested. Pi authentication alone SHALL NOT be shown as a usable web-import model. When no model source is ready, the page SHALL explain why the real import is unavailable and SHALL still allow a dry run. When the Pi session reader cannot be loaded in the server process, Pi preview and import SHALL be unavailable, with that reason.

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

- **WHEN** `memoryApiKey` is `env://NAME` and `NAME` is not set in the web app process
- **THEN** readiness SHALL report the external API as missing its key, without showing a value

#### Scenario: The Pi session reader is unavailable

- **WHEN** the Pi SDK cannot be loaded in the web app process
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

The Memory page SHALL have an **Automatic import** section with a switch for `autoBackfill` and, for each host, a model choice for `opencodeBackfillModel` or `piBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model` chosen the same way as the host's capture model. For each host the section SHALL show the backfill state, including paused, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to that host's Resolve missing project folders list, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Run now, Pause, and Resume for each host. The counts SHALL refresh while a run is active. It SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running backfill after its current exchange. It SHALL say that automatic import makes model calls.

The switch and the section description SHALL stay above the host cards. Each host card SHALL be a keyboard-accessible disclosure. Its summary SHALL show the host name, the backfill state, the pending exchange count, and the unresolved session count. A card SHALL open by default when its host has a running or paused run, and SHALL be collapsed otherwise. A card that the user opened or closed SHALL keep that state while the counts refresh. Collapsing a card SHALL keep any unsaved model choice.

The Automatic import host headings SHALL NOT repeat the overall import-status pills shown in Import chat history. Removing these pills SHALL NOT remove the operational state, last-run summary, unresolved counts, errors, or controls.

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

#### Scenario: Opening the section with no active run

- **WHEN** no host has a running or paused run and the user opens Memory
- **THEN** the Pi, OpenCode, and Claude Code cards SHALL be collapsed
- **AND** each summary SHALL show the host's state, pending exchanges, and unresolved sessions

#### Scenario: A run is active

- **WHEN** a Pi backfill is running and the user opens Memory
- **THEN** the Pi card SHALL be open and the other cards SHALL be collapsed

#### Scenario: Keeping a card's state during refresh

- **WHEN** the user collapses the running Pi card and the counts refresh
- **THEN** the Pi card SHALL stay collapsed

#### Scenario: Reading automatic import without duplicate pills

- **WHEN** the user opens Automatic import for Pi, OpenCode, or Claude Code
- **THEN** its host heading SHALL show the host name without an overall import-status pill
- **AND** the card SHALL retain its operational state and existing actions

#### Scenario: Following the automatic import directory link

- **WHEN** the user activates OpenCode's unresolved-directory link in Automatic import
- **THEN** OpenCode's Resolve missing project folders list SHALL open and its summary SHALL receive focus
- **AND** other hosts' drafts and disclosure states SHALL remain unchanged

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

### Requirement: The page sets the Claude Code folder

The Settings page SHALL have a **Claude Code folder** section with a text field for `claudeConfigDir`. The field SHALL be empty by default. The section SHALL show the projects folder in use and where it comes from: the setting, the `CLAUDE_CONFIG_DIR` environment variable of the web app, or the default. It SHALL warn when that folder does not exist. It SHALL accept an absolute path, or a path that starts with `~/`, and SHALL reject any other value with a message. A project config SHALL NOT override the setting. The text SHALL be available in every language the page supports.

#### Scenario: Setting a folder

- **WHEN** the user enters `/data/claude` and saves
- **THEN** the global config SHALL have `claudeConfigDir` set to `/data/claude`
- **AND** the section SHALL show `/data/claude/projects` as the folder in use, with the source "setting"

#### Scenario: A folder that does not exist

- **WHEN** the folder in use does not exist on this computer
- **THEN** the section SHALL show a warning that names the folder

#### Scenario: Clearing the field

- **WHEN** the user clears the field and saves
- **THEN** the web app SHALL use `CLAUDE_CONFIG_DIR` when it is set, and `~/.claude` when it is not

#### Scenario: A relative path

- **WHEN** the user enters `claude/config` and saves
- **THEN** the page SHALL reject the value and SHALL NOT change the global config

### Requirement: The Embedding card changes the embedder behind a lock

The Settings page SHALL show an **Embedding** card with the embedder in use: kind, server URL, model, vector size, key status, and memory count. The fields SHALL be read-only until the user presses the padlock. Unlocked, the card SHALL offer **Built-in model** or **OpenAI-compatible server**. For a server it SHALL offer presets that fill the URL: Ollama (`http://localhost:11434/v1`), llama.cpp (`http://localhost:8080/v1`), OpenRouter (`https://openrouter.ai/api/v1`), OpenAI (`https://api.openai.com/v1`), and Custom. A preset SHALL fill the URL only and SHALL NOT change the model name. It SHALL take the exact model name as typed text, and an optional API key through the same key source choices as the External API card. **Test** SHALL test the candidate and fill the vector size. **Apply** SHALL be enabled only after a passing test of the current values. **Apply** SHALL open a confirmation that states: every memory will be re-embedded, with the count; a hosted server is called once for each memory; search is poor until the re-embed ends; and open OpenCode and Pi sessions should be restarted. Confirming SHALL apply the change and show re-embed progress. A failed re-embed SHALL show the reason and a **Retry** button. Pressing the padlock again, or **Cancel**, SHALL discard unsaved edits.

#### Scenario: The card starts locked

- **WHEN** the user opens the Settings page
- **THEN** the Embedding card SHALL show the embedder in use with its fields read-only

#### Scenario: Ollama model name

- **WHEN** the user unlocks the card, chooses the Ollama preset, and types `nomic-embed-text`
- **THEN** the URL SHALL read `http://localhost:11434/v1` and the model SHALL read `nomic-embed-text`

#### Scenario: Switching to the built-in model

- **WHEN** the user unlocks a card that uses a server with model `qwen3-embedding:0.6b` and chooses **Built-in model**
- **THEN** the model SHALL read the default built-in model, not the server's model name

#### Scenario: A saved server without a key

- **WHEN** the embedder is a server with no saved key and the user unlocks the card
- **THEN** the API key choice SHALL show **No key** selected

#### Scenario: Apply needs a passing test

- **WHEN** the user edits the model name after a passing test
- **THEN** **Apply** SHALL be disabled until the user tests again

#### Scenario: Confirming the change

- **WHEN** the user presses **Apply** with 3,530 memories stored
- **THEN** the confirmation SHALL state that 3,530 memories will be re-embedded, and the other risks
- **AND** on confirm the card SHALL show progress until the re-embed ends

### Requirement: The Keys and access card lists each credential

The Settings page SHALL show a **Keys and access** card, separate from the model cards. It SHALL list `memoryApiKey`, `embeddingApiKey`, API tokens, and the browser password, each with what it is for, which hosts use it, and where to change it. Each row SHALL show ✅ **set** when it has a value; ⛔️ **missing** when something in use needs it; or a grey label otherwise: **never used before** for `memoryApiKey`, and **not needed** for the other rows. `memoryApiKey` is needed when OpenCode or Pi uses the external API, or when there is evidence that Claude Code is in use: OMMS has recorded a Claude Code capture attempt, or the user has set the Claude Code folder on the page. A default Claude Code folder that exists on disk alone SHALL NOT count as evidence. `embeddingApiKey` is needed only when the embedder is a server whose address is not on this machine. API tokens are needed only when the web app listens on the network and Basic Auth is off. The browser password is never marked needed. The card SHALL NOT show any secret value.

#### Scenario: A local setup

- **WHEN** the web app listens on `127.0.0.1`, the external API key is set, and the embedder is a local server without a key
- **THEN** `memoryApiKey` SHALL show ✅ set
- **AND** `embeddingApiKey`, API tokens, and the browser password SHALL show grey not needed

#### Scenario: Claude Code installed but never used with OMMS

- **WHEN** `~/.claude/projects` exists, no Claude Code capture attempt is recorded, the Claude Code folder setting is empty, no host uses the external API, and `memoryApiKey` is not set
- **THEN** the `memoryApiKey` row SHALL show grey **never used before**

#### Scenario: Claude Code has sent a turn

- **WHEN** a Claude Code capture attempt is recorded and `memoryApiKey` is not set
- **THEN** the `memoryApiKey` row SHALL show ⛔️ missing

#### Scenario: Network binding without protection

- **WHEN** the web app listens on `0.0.0.0` with no token and no password
- **THEN** the API tokens row SHALL show ⛔️ missing

### Requirement: The page manages API tokens and the browser password

The Keys and access card SHALL include an API tokens table with **Generate token**, a name field, and an expiry choice of 7, 30, or 90 days or never. After a token is generated, the page SHALL show its value once with a copy button and a note that it will not be shown again. Each row SHALL have **Revoke**, which asks for confirmation. The card SHALL let the user set or clear the Basic Auth password and user name; a set password SHALL be saved to a private key file and referenced from the global config. These controls SHALL be hidden with a note when the page is not opened from the local machine.

#### Scenario: Generating a token

- **WHEN** the user enters `ci`, chooses 30 days, and presses **Generate token**
- **THEN** the page SHALL show the value once and add a row `ci` with its expiry

#### Scenario: Setting a browser password

- **WHEN** the user sets a password and saves
- **THEN** the global config SHALL reference a private key file for `webServerAuthPassword`
- **AND** the page SHALL NOT show the password after the save

### Requirement: Health checks cover Claude Code

The health checks SHALL include a **Claude Code model** row and a **Claude Code folder** row. The model row SHALL pass when the external API is fully configured, and SHALL fail with the missing settings otherwise. The folder row SHALL pass when the Claude Code transcripts folder in use exists, and SHALL warn with the folder path otherwise. When the user asks for model tests, the checks SHALL also include a **Claude Code model test** row that sends the fixed short prompt to the external API. One health run SHALL send at most one test call to the external API.

#### Scenario: Claude Code is ready

- **WHEN** the external API is fully configured and the transcripts folder exists, and the user runs the checks
- **THEN** the **Claude Code model** row and the **Claude Code folder** row SHALL show pass

#### Scenario: The external API is not complete

- **WHEN** the API key is missing and the user runs the checks
- **THEN** the **Claude Code model** row SHALL show fail, name the missing setting, and contain no secret value

#### Scenario: The transcripts folder is missing

- **WHEN** the transcripts folder in use does not exist
- **THEN** the **Claude Code folder** row SHALL show warn with the folder path

#### Scenario: Testing models

- **WHEN** the external API is complete, Pi uses a manual model, and the user runs the checks and tests models
- **THEN** the page SHALL show a **Claude Code model test** row and a **Pi model test** row
- **AND** the run SHALL send one test call to the external API

### Requirement: Diagnostics can be filtered by host

The capture diagnostics section SHALL offer a **Host** choice of All, OpenCode, Pi, and Claude Code. The server SHALL apply the choice to the outcomes, failure reasons, and recent attempts, so the recent attempts list holds up to its limit for the chosen host alone. The server SHALL refuse any other host value with `400`. The tables SHALL show each host by its display name. The retry queue counts SHALL stay per host.

#### Scenario: Only Claude Code

- **WHEN** the user chooses Claude Code
- **THEN** every table SHALL show only Claude Code attempts, with `Claude Code` in the host column

#### Scenario: An unknown host value

- **WHEN** a request asks for diagnostics with host `other`
- **THEN** the server SHALL answer `400`

### Requirement: The import model option names the saved external API and stays current

The import model choice SHALL show the saved external API as **Saved external API**, without the model name, for every history host, and SHALL still say when it is not ready. After any save on Settings or Memory, the import section SHALL reload its model readiness, including when it is next opened on another route.

#### Scenario: Choosing the import model for Claude Code

- **WHEN** the external API is ready and the user opens the import model choice for Claude Code
- **THEN** the option SHALL read **Saved external API** and SHALL NOT contain the model name

#### Scenario: Changing the external API model

- **WHEN** the user saves a new external API model on Settings and opens Memory
- **THEN** the import section SHALL show the new readiness without a browser reload

### Requirement: The Keys and access card is a table with headings

The Keys and access card SHALL show its rows in a table with the headings **Credential**, **State**, **Used for**, **Hosts**, and **Change it in**, with the same table style as the capture diagnostics tables. The rows, states, and rules of the Keys and access requirement SHALL be unchanged.

#### Scenario: Reading the card

- **WHEN** the user opens the Keys and access card
- **THEN** the page SHALL show a table with the five headings and one row for each credential

### Requirement: Diagnostics outcomes are grouped by host

The outcomes table SHALL show one row for each host that has attempts in the chosen range, at most OpenCode, Pi, and Claude Code, with the host's totals. Each host row SHALL have a control that shows or hides one row for each model of that host. A model row for attempts with no recorded model SHALL say **model not recorded** and SHALL have a tooltip that says no model was recorded, which happens with records written by older OMMS versions and when an attempt stops before a model is chosen. Above the table, the page SHALL explain the columns: **Saved** means a memory was stored, **Skipped** means the model or a rule found nothing worth keeping or the turn was private or trivial, **Failed** means the attempt hit an error, and **Total** is the sum of the three. Each percentage SHALL be the share of that row's total.

#### Scenario: Three hosts with many models

- **WHEN** the last 7 days hold OpenCode attempts with four models, Pi attempts with five models, and Claude Code attempts with two models
- **THEN** the outcomes table SHALL show three host rows
- **AND** opening the Pi row SHALL show its five model rows

#### Scenario: Attempts with no model

- **WHEN** some Pi attempts have no recorded model
- **THEN** the Pi model rows SHALL include a row labelled model not recorded with its counts

### Requirement: Each host shows its import status

The Import chat history section on Memory SHALL show a status badge for each host, derived from that host's latest backfill and import records:

- **Imported ✅** when the latest run finished with no pending exchanges and no unresolved sessions.
- **Partly imported** with the number of unresolved sessions when the latest run finished and some sessions are unresolved.
- **Running** while a run is active, and **Learning profile** while a finished run's profile step is active.
- **Paused**, **Failed** with the last error, or **Not started**, from the backfill state. A run that finished with some failed exchanges SHALL NOT show Failed, because those exchanges are retried at the next run.

The unresolved session count SHALL exclude sessions in directories listed in `importIgnoredDirectories`. The server SHALL apply this when it serves the backfill status, so every badge and card reads the same count. These latest-history status badges SHALL remain separate from the success or failure of the current grouped job.

A Partly imported badge SHALL be a keyboard-accessible link to that host's Resolve missing project folders list. Its visible wording and count SHALL remain present. Its accessible name SHALL identify the host and destination in the current page language. Activating it SHALL reveal the matching host list, scroll to it, and focus its summary without saving settings or starting an import. Other status badges SHALL remain informational.

#### Scenario: All Claude Code history is in

- **WHEN** the latest Claude Code run finished with 0 pending exchanges and 0 unresolved sessions
- **THEN** the Claude Code badge SHALL show Imported ✅

#### Scenario: Unresolved sessions remain

- **WHEN** the latest OpenCode run finished and 6 sessions are unresolved
- **THEN** the OpenCode badge SHALL show Partly imported with 6 unresolved

#### Scenario: Every unresolved directory ignored

- **WHEN** the latest Pi run finished with 0 pending exchanges and 10 unresolved sessions, and the user ignores every directory that holds them
- **THEN** the Pi badge SHALL show Imported ✅

#### Scenario: Following an unresolved badge

- **WHEN** the user activates Pi's Partly imported badge by pointer or keyboard
- **THEN** Pi's Resolve missing project folders list SHALL open and its summary SHALL receive focus
- **AND** the browser SHALL scroll to that list without reloading the page
- **AND** the badge SHALL retain its wording and unresolved count

#### Scenario: A badge without unresolved sessions

- **WHEN** a host's badge shows Imported, Running, Learning profile, Paused, Failed, or Not started
- **THEN** it SHALL NOT become a link to unresolved directories solely because it is a status badge

### Requirement: Automatic import shows the last run when no run is active

When no run is active for a host, the Automatic import card on Memory SHALL NOT show a progress bar. It SHALL show a summary of the latest run: its finish time, how it was started (automatic, Run now, or terminal), and its imported, skipped, and failed counts. The card's counts and the summary SHALL come from the same run record, so they agree.

#### Scenario: After a run finishes

- **WHEN** a Claude Code run finished at 20:35 with 6 imported, 0 skipped, and 0 failed, and the user reloads Memory
- **THEN** the card SHALL show no progress bar
- **AND** SHALL show the finish time 20:35 and the counts 6, 0, and 0

### Requirement: Counts use singular wording and whole-number confidence

The Settings page SHALL say "1 session" for one session and "sessions" for any other number. The profile page SHALL show each confidence badge as a whole-number percentage.

#### Scenario: One session

- **WHEN** an unresolved directory has one session
- **THEN** the page SHALL show "1 session"

#### Scenario: Confidence with decimals

- **WHEN** an item's confidence is 0.969
- **THEN** the badge SHALL show "97%"

### Requirement: The Memory card shows editable limits and their effects

The Memory page SHALL show one **Memory limits** card with an editable table. Its headings SHALL be **Setting**, **Value**, **Default**, **Unit**, and **Affects**. Each row SHALL show the exact config identifier, an accessible numeric input for the saved global value, the default, its unit, and a visible explanation of what it changes.

The rows SHALL cover:

| Setting                      | Default | Unit               | Affects                                                                                                                                                       |
| ---------------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxMemories`                | 10      | Results            | Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.                                                         |
| `chatMessage.maxMemories`    | 3       | Memories           | Recent memories added at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 use prompt-based search instead.                                    |
| `autoCaptureMaxContextBytes` | 131072  | Bytes              | Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.                           |
| `userProfileMaxContextBytes` | 32768   | Bytes              | OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.                 |
| `retrievalMaxTokens`         | 2000    | Approximate tokens | Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories. |

The **Affects** text SHALL stay visible, rather than being available only through a tooltip. The card SHALL explain that the byte controls count UTF-8 bytes, and that approximate tokens use `ceil(bytes / 4)` and can differ from the model's count. It SHALL state that these controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output. It SHALL name `~/.config/omms/omms.jsonc` as the file users can edit without the web UI.

The card SHALL use the existing table appearance and support horizontal scrolling within the card on narrow screens. Its title SHALL be H2 using the shared section-title role; any subsection headings SHALL use H3 and the shared subsection-title role. The application SHALL retain its single H1, and table labels and effect text SHALL remain table content. Every input SHALL have a label and associated validation message. Headings, effects, help, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic; config identifiers SHALL remain literal and readable left-to-right.

#### Scenario: Reading the default limits

- **WHEN** the user opens Memory limits with no saved overrides
- **THEN** the five rows SHALL show defaults of 10, 3, 131072, 32768, and 2000
- **AND** each input SHALL have its effect and unit visible beside it

#### Scenario: Reading host-specific effects

- **WHEN** a Pi user reads the recent-memory and profile-input rows
- **THEN** the page SHALL explain their existing host coverage
- **AND** it SHALL NOT suggest that either setting limits Pi's profile-learning input

#### Scenario: Viewing a narrow Arabic layout

- **WHEN** the user opens Memory limits in Arabic on a narrow screen
- **THEN** the table SHALL remain usable without forcing the whole page wider
- **AND** the config identifiers SHALL retain their technical order
- **AND** the effect explanations and input labels SHALL appear in Arabic

### Requirement: The Memory card saves limits through the existing safe config flow

The Memory limits card SHALL offer **Save** and **Cancel**. Save SHALL be available only when a valid draft differs from the loaded global values. Cancel SHALL restore the loaded values without writing. While a save runs, the card SHALL prevent duplicate submissions and show its result. Successful saves SHALL refresh the shared Settings revision used by both pages.

The save SHALL use the existing Settings authentication, origin, JSON request, validation, conflict, and legacy-file rules. It SHALL change only edited values in the global config. Saving `chatMessage.maxMemories` SHALL update that nested property while preserving the other `chatMessage` properties, their comments, and every unrelated key. A save SHALL NOT create a literal `chatMessage.maxMemories` key or allow arbitrary nested settings to be edited.

The card SHALL show the effective value and the source when the selected project's config overrides a row. It SHALL still edit the global value and SHALL say that the project override remains in force. Values SHALL follow the validation and next-operation behaviour of the memory-context-controls capability. A rejected save SHALL leave the file unchanged and show the setting's accepted values, or the stale-file recovery action.

#### Scenario: Saving one nested value

- **WHEN** the user changes `chatMessage.maxMemories` from 3 to 2 and saves
- **THEN** the global file SHALL contain `"maxMemories": 2` inside its `chatMessage` object
- **AND** `enabled`, `injectOn`, `excludeCurrentSession`, `maxAgeDays`, and their comments SHALL be unchanged
- **AND** the top-level `maxMemories` SHALL be unchanged

#### Scenario: Rejecting an unrelated nested edit

- **WHEN** a request to save Memory limits also tries to edit `chatMessage.enabled`
- **THEN** the server SHALL reject that unsupported edit without writing any part of the request

#### Scenario: Invalid numeric input

- **WHEN** the user enters a blank value, negative value, fractional value, or value outside the accepted range
- **THEN** the input SHALL show an associated validation message
- **AND** Save SHALL be disabled
- **AND** the server SHALL also reject the invalid value if submitted directly

#### Scenario: Cancelling a draft

- **WHEN** the user edits two values and selects Cancel
- **THEN** both inputs SHALL return to their loaded values
- **AND** the config file SHALL remain unchanged

#### Scenario: Another editor changes the file

- **WHEN** another process changes `omms.jsonc` before the card saves its draft
- **THEN** the save SHALL be refused without writing
- **AND** the card SHALL load the current values and ask the user to review and save again

#### Scenario: The project overrides the global budget

- **WHEN** the project budget is 1000 and the user saves a global budget of 3000
- **THEN** the card SHALL show global 3000 and effective project 1000
- **AND** the project file SHALL remain unchanged

#### Scenario: Saving another card after Memory

- **WHEN** Memory limits saves successfully and the user then saves a model choice on Settings
- **THEN** the other card SHALL use the refreshed Settings revision
- **AND** its save SHALL NOT fail solely because Memory limits changed the revision

### Requirement: The Settings sidebar navigates to the Memory card

The sidebar SHALL contain one **Memory limits** child under Memory, linked to `/memory#memory-section-limits`. Selecting it SHALL open Memory when necessary and bring the limits card into view. Direct navigation and reload at that URL SHALL reveal the same card. `/settings#settings-section-memory` SHALL redirect to that destination. Desktop collapse and mobile drawer behaviour SHALL remain consistent with the existing section links. Other Settings cards SHALL keep their existing anchors. Host-specific unresolved-folder links SHALL still reveal and focus the matching host disclosure without resetting unsaved map targets or selections.

#### Scenario: Opening Memory from the project view

- **WHEN** the user selects Memory limits under Memory while viewing project memories
- **THEN** Memory SHALL open with the limits card in view

#### Scenario: Following a saved link

- **WHEN** the user opens or reloads `/settings#settings-section-memory`
- **THEN** Memory SHALL open at `/memory#memory-section-limits`
- **AND** the limits card SHALL be brought into view after the page mounts

#### Scenario: Directory maps navigation remains available

- **WHEN** the user opens Memory limits and then follows a Pi, OpenCode, or Claude Code unresolved-import link
- **THEN** the matching host's Resolve missing project folders disclosure SHALL open and receive focus
- **AND** unsaved map targets and selections SHALL remain unchanged

#### Scenario: Finding Memory in the sidebar

- **WHEN** the Memory tree is expanded on desktop or in the mobile drawer
- **THEN** Memory limits SHALL appear once as a child of Memory
- **AND** it SHALL not appear under Settings
- **AND** its accessible label SHALL use the page's language
