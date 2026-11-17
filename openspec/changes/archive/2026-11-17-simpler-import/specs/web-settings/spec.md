## MODIFIED Requirements

### Requirement: History imports can be run from a session list

The Memory page SHALL list Pi, OpenCode, and Claude Code sessions from each chosen history source. In the web app the scope SHALL default to all projects, because the web app runs from the home folder and has no current project of its own. Each bounded page SHALL show selection keys, session IDs where present, the session title for OpenCode sessions that store one, dates, recorded project directories, and how each directory was resolved (recorded, mapped, worktree, or unresolved), without conversation content. A session title SHALL be the title the host stores with the session, shortened to at most 80 characters, and SHALL NOT be read from the prompts or replies. The user SHALL be able to select individual sessions or all sessions matching the current source, scope, project, and saved directory maps across pages. The page SHALL show the selection count and run a dry-run preview of that exact selection before a real import. Selecting multiple hosts SHALL retain separate pinned selections and follow the multi-host-import capability.

The session list SHALL return a revision and a listing time. The revision SHALL be derived from the source identity, the matching options, and the sorted keys of the matching sessions. It SHALL NOT be derived from file sizes or modification times. A preview or import of an explicit selection SHALL be refused as stale when a selected session no longer exists or resolves to a different project. A preview or import of all matching sessions SHALL be refused as stale when the recomputed revision differs. Both SHALL import only user turns at or before the listing time, so the preview and the import read the same turns. The server SHALL keep no selection state between requests.

The session list and the importer SHALL resolve project directories with the same rules, in this order on all hosts: an exact directory map, then the recorded directory, then, for OpenCode only, the project worktree. Sessions that cannot be resolved SHALL NOT be assigned to any project. The page SHALL report how many sessions have missing directories and link to the host's list of sessions that need a folder.

Web selections SHALL reuse the shared importer and its ledger. CLI and slash-command flags SHALL keep their meaning, with two exceptions. A Pi `--root` that names one `.jsonl` file SHALL import that file. An OpenCode directory map SHALL take precedence over a recorded directory that still exists. The page SHALL NOT offer the single-session or maximum-sessions options; selection replaces them. The page SHALL NOT offer a directory map text box; the session list and imports started from the page SHALL use the saved directory maps.

The main view SHALL show the readiness checklist, the model line, the primary import button, progress, cancellation and the result. A **Customise** section, closed by default, SHALL hold host choices, project scope, positive Project memories and User profile choices, session lists, selections, the import model choice, preview and start. User profile SHALL identify preferences, patterns, and workflows. Both outputs SHALL be selected by default, and choosing neither SHALL be refused. Advanced options inside Customise SHALL hold project path details, prompt date range, source overrides, profile batch size, and re-analysis. Date limits SHALL be labelled as inclusive **Prompt date from** and **Prompt date to**. They SHALL filter user turns within sessions, SHALL NOT filter the session list, and SHALL be interpreted in the browser's time zone. Empty limits SHALL include all turns. Turns that have no timestamp SHALL be included and counted in the preview. Only one preview or import SHALL run at a time, including a grouped import. Imports SHALL stay idempotent and failed units retryable. The page SHALL say in one line that chats already imported are skipped, so running an import again is safe.

A real web import SHALL use an OpenCode-connected model or a complete saved external API under each host's existing rules; Claude Code SHALL use the external API only. The page SHALL show the readiness of each model source before a job starts. A model that is configured but not tested SHALL be labelled as not tested; a model whose test call failed SHALL be labelled as failed with the reason. The server SHALL check readiness again when a job is requested. Pi authentication alone SHALL NOT be shown as a usable web-import model. When no model source is ready, the page SHALL explain why the real import is unavailable and SHALL still allow a dry run from Customise. When the Pi session reader cannot be loaded in the server process, Pi preview and import SHALL be unavailable, with that reason. A preview that reports no work SHALL leave the real import unavailable.

#### Scenario: Selecting sessions across pages

- **WHEN** the user chooses Select all matching sessions in all projects
- **THEN** the selection SHALL include matching sessions on every page, not only those visible
- **AND** the page SHALL show how many sessions will be previewed

#### Scenario: Default scope in the web app

- **WHEN** the user opens Customise on a host view for the first time in this browser
- **THEN** the scope SHALL read All projects

#### Scenario: An OpenCode session with a title

- **WHEN** an OpenCode session stores the title `Fix the login redirect`
- **THEN** its row SHALL show that title next to the session ID

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

- **WHEN** the user saves a directory map after listing and then previews
- **THEN** the preview SHALL be refused as stale and the page SHALL ask the user to refresh the list

#### Scenario: Sessions with missing directories in the current project view

The scenario title is kept so the archive step can match it. The rule now applies in every scope.

- **WHEN** some sessions record directories that no longer exist
- **THEN** the page SHALL show how many there are and link to the host's list of sessions that need a folder
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
- **THEN** Preview SHALL remain available in Customise
- **AND** Import SHALL be disabled with a reason that tells the user what to configure
- **AND** a request to start an import SHALL be rejected with that reason before any job starts

#### Scenario: A preview with no work

- **WHEN** a preview reports no sessions and no pending work
- **THEN** **Start import** SHALL be disabled and the page SHALL say there is nothing new to import

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

### Requirement: The page controls automatic import

Each host view on the Memory page SHALL have a settings card with the **Import past chats automatically** switch for `autoBackfill`, which applies to every host, and, for Pi and OpenCode, a backfill model choice for `piBackfillModel` or `opencodeBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model`. Claude Code's backfill always uses the external API. The host view's status header SHALL show the backfill state, including paused and off, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to that host's list of sessions that need a folder, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Pause, Resume and Retry as the import progress capability defines. The counts SHALL refresh while a run is active. The settings card SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running automatic backfill after its current exchange. It SHALL say that automatic import makes model calls. Turning the switch on SHALL open the same confirm dialog as **Turn on** in the status header, and only its **Turn on** SHALL save; turning the switch off SHALL save at once with no dialog.

#### Scenario: Turning automatic import off

- **WHEN** the user turns off the switch while an automatic Pi backfill runs
- **THEN** the global config SHALL have `autoBackfill` set to `false`
- **AND** the Pi backfill SHALL stop after its current exchange
- **AND** the Pi status header SHALL read **Off** once the run has stopped

#### Scenario: Choosing a backfill model for Pi

- **WHEN** the user picks provider `zai` and model `glm-5-turbo` for Pi's backfill and saves
- **THEN** the global config SHALL have `piBackfillModel` set to `zai/glm-5-turbo`
- **AND** `piProvider` and `piModel` SHALL be unchanged

#### Scenario: Choosing the external API for OpenCode's backfill

- **WHEN** the user chooses External API for OpenCode's backfill and saves
- **THEN** the global config SHALL have `opencodeBackfillModel` set to `external`

#### Scenario: Watching progress

- **WHEN** a backfill runs while the host view is open
- **THEN** the counts, progress bar, percentage, and time left SHALL update without a page reload

#### Scenario: Opening the section with no active run

The scenario title is kept so the archive step can match it. The Automatic import section and its host cards no longer exist; each host view holds one host.

- **WHEN** no host has a running or paused run and the user opens `/memory/pi`
- **THEN** the status header SHALL show Pi's state, pending exchanges, and unresolved sessions

#### Scenario: A run is active

- **WHEN** a Pi backfill is running and the user opens `/memory/pi`
- **THEN** the status header SHALL show the progress bar, percentage and time left

#### Scenario: Keeping a card's state during refresh

The scenario title is kept so the archive step can match it.

- **WHEN** the counts refresh while the user edits Pi's backfill model choice
- **THEN** the unsaved model choice SHALL stay

#### Scenario: Reading automatic import without duplicate pills

The scenario title is kept so the archive step can match it.

- **WHEN** the user opens `/memory/opencode`
- **THEN** the status header SHALL show the host name without an overall import-status pill
- **AND** it SHALL keep its operational state and its one main action

#### Scenario: Following the automatic import directory link

- **WHEN** the user activates OpenCode's unresolved-directory link in the status header
- **THEN** OpenCode's list of sessions that need a folder SHALL open and its summary SHALL receive focus
- **AND** other hosts' drafts and disclosure states SHALL remain unchanged

### Requirement: Automatic import shows the last run when no run is active

When no run is active for a host, the host view's status header SHALL NOT show a progress bar. It SHALL show a summary of the latest run: its finish time, how it was started (automatically, from the page, or from the terminal), and its imported, skipped, and failed counts. The counts and the summary SHALL come from the same run record, so they agree.

#### Scenario: After a run finishes

- **WHEN** a Claude Code run finished at 20:35 with 6 imported, 0 skipped, and 0 failed, and the user reloads `/memory/claude-code`
- **THEN** the status header SHALL show no progress bar
- **AND** SHALL show the finish time 20:35 and the counts 6, 0, and 0
