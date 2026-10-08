# Spec Delta

## MODIFIED Requirements

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

### Requirement: The import model option names the saved external API and stays current

The import model choice SHALL show the saved external API as **Saved external API**, without the model name, for every history host, and SHALL still say when it is not ready. After any save on Settings or Memory, the import section SHALL reload its model readiness, including when it is next opened on another route.

#### Scenario: Choosing the import model for Claude Code

- **WHEN** the external API is ready and the user opens the import model choice for Claude Code
- **THEN** the option SHALL read **Saved external API** and SHALL NOT contain the model name

#### Scenario: Changing the external API model

- **WHEN** the user saves a new external API model on Settings and opens Memory
- **THEN** the import section SHALL show the new readiness without a browser reload

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
