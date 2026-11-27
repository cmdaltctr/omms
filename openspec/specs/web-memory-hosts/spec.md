# web-memory-hosts Specification

## Purpose

Let a user see and act on one host at a time. The Memory page shows a card for each host and for the settings they share. A host view holds that host's status, one main action, sessions, folders that need a map and settings. A host avatar can be changed, and the cards warn when memories cannot be saved.

## Requirements

### Requirement: The Memory overview shows one card per host and a Shared card

`/memory` SHALL show four cards of equal size in this order: Pi, OpenCode, Claude Code and Shared. Each host card SHALL show the host's avatar, its name and one status line built from that host's import, backfill and live capture state. A host that is set up, not paused and not failed SHALL read `Running` while automatic import is on, and `Automatic import off` while it is off, followed by the date of its last history import and the time of its last live save when each is known, for example `Running · history imported 19 Oct · last saved today 18:52`. A paused host SHALL read for example `Paused · 0 pending`. The Shared card SHALL say that its settings apply to every host. Activating a card SHALL open its view. Below the cards, an **Import all hosts** panel SHALL hold the readiness checklist and the **Import all hosts** button defined by the one-button import requirement, for every host that is set up, and SHALL say that it makes model calls that can cost money. On a viewport narrower than 640 px the cards SHALL form a two-column grid without horizontal scrolling.

#### Scenario: Opening the overview

- **WHEN** the user opens `/memory`
- **THEN** the page SHALL show the Pi, OpenCode, Claude Code and Shared cards in that order
- **AND** each host card SHALL show a status line for that host

#### Scenario: A host that finished its last run

- **WHEN** OpenCode is set up, not paused, not failed, automatic import is on, and its last run ended with nothing pending
- **THEN** the OpenCode card SHALL read `Running` and SHALL show the date of the history import as a second detail, for example `history imported 19 Oct`
- **AND** the card SHALL NOT read only `Imported` with a date

#### Scenario: Automatic import is off

- **WHEN** the user turned off **Import past chats automatically** and no run is active for Pi
- **THEN** the Pi card SHALL read `Automatic import off` and SHALL NOT read `Running`

#### Scenario: Opening a host from the overview

- **WHEN** the user activates the OpenCode card with a pointer or with Enter or Space
- **THEN** the page SHALL navigate to `/memory/opencode`

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the cards SHALL show as two rows of two
- **AND** the page SHALL NOT scroll horizontally

### Requirement: A host view shows only that host

`/memory/pi`, `/memory/opencode` and `/memory/claude-code` SHALL show only the named host's content, in this order: the status header, the import panel (readiness checklist, model line, **Import new chats**, progress, result and the closed **Customise** section), the host's sessions that need a folder, and the host's own settings (backfill model and automatic import). A compact card switcher SHALL stay at the top with the current host marked, and SHALL include Shared. The same switcher SHALL stay at the top of the Shared view, with Shared marked. The chosen view SHALL survive a reload, and the browser Back action SHALL return to the previous view. A host view SHALL NOT show another host's sessions, models or state.

#### Scenario: Reloading a host view

- **WHEN** the user reloads `/memory/opencode`
- **THEN** the OpenCode view SHALL open again

#### Scenario: Switching from Shared

- **WHEN** the user is on `/memory/shared`
- **THEN** the four cards SHALL show at the top with Shared marked as current
- **AND** activating Pi SHALL open `/memory/pi`

#### Scenario: Switching hosts

- **WHEN** the user is on `/memory/opencode` and activates Pi in the switcher
- **THEN** the page SHALL show only Pi's content at `/memory/pi`
- **AND** Back SHALL return to `/memory/opencode`

#### Scenario: Opening a host view

- **WHEN** the user opens `/memory/pi`
- **THEN** **Import new chats** SHALL be visible without opening any section
- **AND** the **Customise** section SHALL be closed

### Requirement: The status header has one main action and explains it

A host view's status header SHALL show the state (running, off, paused, stopped, failed or not set up), one status line, the last run time with its outcome, and the model in use. The status line SHALL read `History imported up to {date} · {n} chat exchanges waiting · Automatic import on` or `… · Automatic import off`, where the date is the backfill cutoff, `{n}` is the number of exchanges still waiting for the backfill, and each part is left out when it is unknown. While **Import past chats automatically** is on, a host that is set up, not paused and not failed SHALL show the state **Running**, whether or not a run is in progress. While the switch is off and no run is active, such a host SHALL show the state **Off**, also when the server reports that the host cannot start a run; only a run cut short with exchanges still pending SHALL keep the state **Stopped**. The host card line SHALL follow the same rule. The header SHALL show exactly one main action whose label follows the state: **Pause** while running, **Turn on** while off, **Resume** while paused, **Retry** after a failure, and **Resume** after a run was cut short with exchanges still pending. **Turn on** SHALL open a confirm dialog built on the shared dialog that says, in one or two plain lines, that automatic import will run for every host and makes model calls. Only the dialog's **Turn on** SHALL save `autoBackfill` as `true`; **Cancel** SHALL save nothing. The header SHALL NOT offer **Run now**. The state **Stopped** SHALL show only when a run was cut short, or while the switch is on and the server says the host cannot start a run. Under the action, one sentence SHALL say what the last run did or why the action is unavailable. The header SHALL say in one line that automatic import brings in chats up to the cutoff date by itself, and that **Import new chats** brings in every chat not yet imported, newer chats included. When the action is unavailable because the backfill model needs the host open, the sentence SHALL say so and offer a control that switches that host's backfill model to the saved external API. The header SHALL say that running an import makes model calls.

#### Scenario: Running with nothing to import

- **WHEN** automatic import is on and a host is set up, not paused and not failed, and its last run ended with nothing pending
- **THEN** the state SHALL read **Running** and the main action SHALL read **Pause**
- **AND** the sentence SHALL say that automatic import is on and nothing is waiting

#### Scenario: Automatic import turned off

- **WHEN** the user turned off **Import past chats automatically**, and Pi is set up, not paused, not failed and not running
- **THEN** the state SHALL read **Off** and the main action SHALL read **Turn on**
- **AND** the sentence SHALL say that automatic import is off and that **Import new chats** imports by hand
- **AND** the header SHALL NOT read **Running** or "Automatic import is on"

#### Scenario: Turning automatic import on from the header

- **WHEN** the state reads **Off** and the user selects **Turn on**
- **THEN** a dialog SHALL say that automatic import will run for every host and makes model calls
- **AND** nothing SHALL be saved until the user selects **Turn on** in the dialog
- **WHEN** the user selects **Turn on** in the dialog
- **THEN** the global config SHALL have `autoBackfill` set to `true`
- **AND** the state SHALL read **Running** after the settings reload

#### Scenario: Automatic import off for a host that cannot start a run

- **WHEN** automatic import is off and the server reports that Pi's backfill model needs Pi open
- **THEN** the state SHALL read **Off** and the main action SHALL read **Turn on**, enabled
- **AND** the host card line SHALL read `Automatic import off`, not `Stopped`

#### Scenario: A user-started run while automatic import is off

- **WHEN** automatic import is off and the user resumes a paused Pi backfill
- **THEN** the state SHALL read **Running** with **Pause** while the run is in progress

#### Scenario: A host that never ran

- **WHEN** automatic import is on and a host is set up, not paused and not failed, and no import has run yet
- **THEN** the state SHALL read **Running** and the main action SHALL read **Pause**

#### Scenario: Pausing an idle host

- **WHEN** the user selects **Pause** while no run is in progress
- **THEN** the paused flag SHALL be saved
- **AND** the state SHALL read **Paused** and the main action SHALL read **Resume**
- **AND** no automatic run SHALL start for that host until the user selects **Resume**

#### Scenario: Paused and blocked by the model choice

- **WHEN** OpenCode's backfill is paused and its backfill model is the live capture model while OpenCode is not open
- **THEN** **Resume** SHALL be unavailable
- **AND** the sentence SHALL say that the model runs only inside OpenCode and offer **Use external API**

#### Scenario: Run now with nothing to import

The scenario title is kept so the archive step can match it. **Run now** no longer exists; a run starts through **Resume**.

- **WHEN** the user selects **Resume** and the backfill finds no pending exchange before its cutoff
- **THEN** the sentence SHALL say that nothing was waiting before the cutoff date
- **AND** it SHALL point to **Import new chats** for newer chats

#### Scenario: A run cut short with exchanges pending

- **WHEN** a run was cut short and exchanges are still pending
- **THEN** the state SHALL read **Stopped** and the main action SHALL read **Resume**

#### Scenario: A failed run

- **WHEN** the last backfill run failed
- **THEN** the main action SHALL read **Retry**
- **AND** the sentence SHALL give the failure reason with any key redacted

#### Scenario: The status line

- **WHEN** automatic import is on, the Pi cutoff is 28 Sep and 12 exchanges wait
- **THEN** the status line SHALL read `History imported up to 28 Sep · 12 chat exchanges waiting · Automatic import on`

### Requirement: A host's sessions that need a folder are listed in its view

A host view's session list SHALL show sessions that can be imported and, in a separate group in the same list, every directory whose sessions need a folder, with its session count. This SHALL apply in both Current project and All projects scope. Each directory row SHALL offer a folder field, a suggested folder when one exists, and **Ignore**. The group SHALL offer **Ignore all**. A folder typed into a row SHALL be saved as a directory map only after the user confirms it. Sessions with no recorded directory SHALL show as one entry that cannot be mapped or ignored.

#### Scenario: All projects scope with missing folders

- **WHEN** the OpenCode session list covers All projects and 21 sessions in 3 directories have no existing folder
- **THEN** the list SHALL show a group of 3 directories with session counts that add up to 21

#### Scenario: Mapping a directory from the session list

- **WHEN** the user types `~/Development/PROJECTS/omms` for `/private/tmp/oc-mem-phase1/project` and confirms
- **THEN** a directory map from that directory to the typed folder SHALL be saved
- **AND** the 7 sessions SHALL become importable after the list refreshes

### Requirement: The Shared view holds settings that apply to every host

`/memory/shared` SHALL show the four-card switcher, then profile learning, memory limits, keyword matching, the reranker, and saved directory maps with ignored directories, each as one row with a one-line summary that opens in place. These sections SHALL NOT appear in a host view. The view SHALL say that its settings apply to every host.

#### Scenario: Finding the reranker

- **WHEN** the user opens `/memory/shared`
- **THEN** the Reranker row SHALL show its current state in its summary
- **AND** opening the row SHALL show the full reranker settings

### Requirement: A host that is not set up shows a setup note

When a host's default history source does not exist on this machine and no custom source is saved, its card SHALL be greyed and read **Not set up**. Its view SHALL show a short note and a link to that host's setup guide in place of the session list and main action. The card SHALL keep its size and position.

#### Scenario: Pi not installed

- **WHEN** the Pi session folder does not exist and no Pi source is saved
- **THEN** the Pi card SHALL read **Not set up**
- **AND** `/memory/pi` SHALL link to the Pi setup guide

### Requirement: Users can choose each host's avatar

Each host card SHALL offer a **Change icon** menu with **Upload image**, **Choose icon** and **Reset to default**. Every avatar SHALL show as a square of one fixed size on every card, whatever the source image size or aspect ratio. An uploaded image SHALL be centre-cropped to a square, redrawn and stored at 128 × 128 pixels, which removes embedded metadata. The page SHALL accept PNG, JPEG, WebP and GIF files up to 20 MB and SHALL refuse SVG and any other type with an accessible message. **Choose icon** SHALL offer a searchable icon grid with a preview. **Reset to default** SHALL restore the host's default mark. The choice SHALL be stored in the global OMMS data folder, not in a project, and SHALL apply in every project. The server SHALL accept only a 128 × 128 PNG of at most 256 KB for a host image and SHALL require the web API token for every change.

#### Scenario: Uploading a wide photo

- **WHEN** the user uploads a 3000 × 1200 JPEG for OpenCode
- **THEN** the OpenCode avatar SHALL show the centre square of the photo at the same size as the other avatars

#### Scenario: Uploading an SVG

- **WHEN** the user picks an SVG file
- **THEN** nothing SHALL be stored
- **AND** the page SHALL say that only PNG, JPEG, WebP and GIF are accepted

#### Scenario: Choosing an icon

- **WHEN** the user chooses the terminal icon for Pi and saves
- **THEN** the Pi card SHALL show that icon in the avatar square after a reload

### Requirement: Host cards warn when memories cannot be saved

The page SHALL check whether new memories can be saved when the Memory page opens, every 5 minutes while it is visible, and when the user selects **Check again**. The check SHALL open the memory store and embed one fixed test string, and SHALL send no conversation content. When the check fails, every host card for a host that is set up SHALL show a warning colour and the text **Memories not saved** with a short reason, and every host view SHALL show a strip with the reason, what to do next, and **Check again**. The warning SHALL be text as well as colour. The reason SHALL NOT contain any secret.

#### Scenario: Embedding server returns 500

- **WHEN** the embedding API returns HTTP 500 for the test string
- **THEN** each host card SHALL read **Memories not saved** with `Embedding server error (500)`
- **AND** each host view SHALL show the strip with **Check again**

#### Scenario: A host that is not set up while memories fail

- **WHEN** the check fails and Pi is not set up on this machine
- **THEN** the Pi card SHALL read **Not set up** and SHALL NOT show the warning

#### Scenario: The server recovers

- **WHEN** the embedding API answers again and the user selects **Check again**
- **THEN** the warning SHALL leave every card and view

### Requirement: A host card shows the last live save

A running host card SHALL add `last saved` with the time of the host's newest live capture that saved a memory, read from the capture records OMMS already keeps. The time SHALL read `today` or `yesterday` with the time, or the date and time when older, in the user's date and time format. Only saved live captures SHALL count. The card SHALL read the time again at least once a minute.

#### Scenario: A save today

- **WHEN** Claude Code saved a live capture today at 18:52 and its history import ended on 18 Oct
- **THEN** the Claude Code card SHALL read `Running · history imported 18 Oct · last saved today 18:52`

#### Scenario: No live save in the kept records

- **WHEN** Pi has no saved live capture in the kept records
- **THEN** the Pi card SHALL NOT show a `last saved` part

#### Scenario: A host with live saves but no history import

- **WHEN** a host never ran a history import and saved a live capture yesterday at 09:05
- **THEN** its card SHALL read `Running · last saved yesterday 09:05`

#### Scenario: Only failed or skipped captures

- **WHEN** a host's newest live capture failed and its newest saved live capture was on 28 Oct at 17:45
- **THEN** its card SHALL show `last saved 28 Oct 17:45`

### Requirement: The Memory overview shows a Memory injection section below the host cards

`/memory` SHALL show a "Memory injection" section below the host cards and the **Import all hosts** row, with: an "Inject memories at session start" switch noting it adds to the first message of a new session; a 500-character text area for `openingContextQuery`; a "Subagent memory" switch; and a "Restore memories after compaction or resume" switch with its memory limit. It SHALL say the options apply to OpenCode V2, Pi and Claude Code, and which ones a project can turn on.

#### Scenario: Where the section sits

- **WHEN** the user opens `/memory`
- **THEN** the Memory injection section SHALL come after the Pi, OpenCode, Claude Code and Shared cards and after the Import all hosts row
- **AND** the Settings page SHALL show no Memory injection section

#### Scenario: The section shows current values

- **WHEN** the global file sets `openingContext` to `true` and a custom query
- **THEN** the section SHALL show the switch on and the custom query

#### Scenario: The section shows defaults

- **WHEN** the global file sets none of the options
- **THEN** the section SHALL show "Inject memories at session start" off, the query `project architecture, setup, conventions and key decisions`, "Subagent memory" on, and "Restore memories after compaction or resume" on with limit 10

#### Scenario: The host note

- **WHEN** the user reads the section
- **THEN** it SHALL name OpenCode V2, Pi and Claude Code
- **AND** it SHALL NOT mention OpenCode V1

#### Scenario: The project note

- **WHEN** the user reads the section
- **THEN** it SHALL say a project configuration can only turn off the session-start and subagent options, and can turn the restore on or off

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the switches, the text area and the limit field SHALL fit the width
- **AND** the page SHALL NOT scroll horizontally

#### Scenario: Translations

- **WHEN** the user picks Chinese or Arabic
- **THEN** every label, note and message in the section SHALL show in that language

### Requirement: The Memory injection section saves through the safe config flow

Save SHALL write `openingContext`, `openingContextQuery`, `subagentMemory`, `compaction.enabled` and `compaction.memoryLimit` to the global configuration through the existing config writer. The writer SHALL accept a boolean for each switch, a query whose trimmed length is 0 to 500, and a positive whole number for the limit. It SHALL reject other values with a message that names the key and the rule and does not repeat the value. Reset to default SHALL remove the keys.

#### Scenario: Save a query

- **WHEN** the user types a query of 120 characters and presses Save
- **THEN** the global file SHALL hold the trimmed query
- **AND** the next first prompt SHALL use it, with no restart

#### Scenario: A query that is too long

- **WHEN** a request sends a query of 501 characters
- **THEN** the writer SHALL reject it with "openingContextQuery must be text of 500 characters or fewer"
- **AND** the message SHALL NOT hold any of the submitted text

#### Scenario: A switch value that is not a boolean

- **WHEN** a request sends `subagentMemory` or `compaction.enabled` as the text "yes"
- **THEN** the writer SHALL reject it and leave the file unchanged

#### Scenario: Turn the restore off

- **WHEN** the user turns "Restore memories after compaction or resume" off and presses Save
- **THEN** the global file SHALL hold `compaction.enabled` as `false` and keep `compaction.memoryLimit`
- **AND** no host SHALL restore memories after the next compaction or resume, with no restart

#### Scenario: A restore limit that is not valid

- **WHEN** a request sends `compaction.memoryLimit` as 0, -3, 2.5 or text
- **THEN** the writer SHALL reject it with a message that names the key and the rule and holds none of the submitted value

#### Scenario: Reset to default

- **WHEN** the user presses Reset to default and then Save
- **THEN** the global file SHALL hold none of the section's keys, and the section SHALL show the defaults

### Requirement: The Shared view links to the Memory injection section

`/memory/shared` SHALL show one "Memory injection" row whose summary gives the state of the three switches and which links to the section on `/memory`. The row SHALL NOT hold its own controls, so the options have one editing surface.

#### Scenario: Following the link

- **WHEN** the user opens `/memory/shared` and activates the Memory injection row
- **THEN** the page SHALL navigate to `/memory#memory-injection` and show the section

#### Scenario: No second editing surface

- **WHEN** the user opens `/memory/shared`
- **THEN** the Memory injection row SHALL hold no switch, text area or number field

### Requirement: A readiness checklist guards the import button

Above the import button, the import panel SHALL show three checks in words as well as colour: **Model** (each chosen host's import model is ready and its last test did not fail), **Memories saving** (the last write check passed), and **History found** (each chosen host's history exists and its reader loads). An untested ready model SHALL read as not tested and SHALL NOT block. While a check fails, the import button SHALL be disabled and the row SHALL say what to do.

#### Scenario: A failed check blocks only the import

- **WHEN** the Memories saving check fails
- **THEN** manual `memory` operations, the session list in **Customise** and the rest of the page SHALL keep working

#### Scenario: A host with no history

- **WHEN** no OpenCode history exists on this computer and the user opens `/memory/opencode`
- **THEN** the History found row SHALL fail and say to install OpenCode and use it once

#### Scenario: The external API key is missing

- **WHEN** the saved external API has no key and the user opens `/memory/claude-code`
- **THEN** the Model row SHALL fail with a plain sentence that names no config key and no host, and link to the external API settings
- **AND** **Import new chats** SHALL be disabled

#### Scenario: Memories cannot be saved

- **WHEN** the memory write check fails
- **THEN** the Memories saving row SHALL fail with the reason and **Check again**
- **AND** the import button SHALL be disabled

#### Scenario: A model not yet tested

- **WHEN** every check passes and the model has not been tested on this page
- **THEN** the Model row SHALL read ready, not tested
- **AND** the import button SHALL be enabled

### Requirement: One button previews an import with defaults

A host view SHALL offer **Import new chats** and the overview **Import all hosts** as the primary button. Pressing it SHALL test the model when the model-test requirement asks for it, list each chosen host's sessions, and run a dry-run preview of all projects, Project memories and User profile (plus Skill turns while recording is on), every session not yet handled, with the model in the model line. Nothing SHALL be imported until the user confirms.

#### Scenario: Importing new chats for Pi

- **WHEN** every check passes and the user selects **Import new chats** on `/memory/pi`
- **THEN** the page SHALL preview every Pi session that is not yet handled, in all projects
- **AND** a dialog SHALL show the session count, the estimated model calls and that imported chats are skipped
- **AND** no model call for extraction SHALL happen before the user selects **Import**

### Requirement: A confirm dialog states the cost before an import

When a preview finds work, a confirm dialog built on the shared dialog SHALL open. It SHALL state the sessions, the estimated model calls (memory units plus profile analysis calls), the estimated time from the speed of recent runs, and that imported chats are skipped. It SHALL offer **Cancel** and **Import**; the import SHALL use the previewed selection. No work SHALL show **Nothing new to import** and no dialog. The browser's confirm box SHALL NOT be used.

#### Scenario: Nothing to import

- **WHEN** every Pi session is handled and the user selects **Import new chats**
- **THEN** the panel SHALL say **Nothing new to import**
- **AND** no dialog SHALL open and no import SHALL start

#### Scenario: Cancelling the dialog

- **WHEN** the confirm dialog is open and the user selects **Cancel**
- **THEN** no import SHALL start and the preview counts SHALL stay under **Details**

#### Scenario: No rate known

- **WHEN** any chosen host with work has no finished run of at least 5 memory units over at least one minute
- **THEN** the dialog SHALL say that the time is known once the import starts

#### Scenario: Hosts import one after another

- **WHEN** the preview finds 30 calls for Pi and 30 for OpenCode, Pi's last run did 2 units a minute and OpenCode's 1 a minute
- **THEN** the dialog SHALL say about 45 minutes, the sum of each host's own time

#### Scenario: A rate from the last run

- **WHEN** Pi's latest finished run did 60 memory units in 30 minutes and the preview finds 40 units and 2 profile calls
- **THEN** the dialog SHALL say about 42 model calls and about 21 minutes

### Requirement: The import model is tested once before the first preview

When the import model is the saved external API and that model has not been tested since the page loaded, the primary button SHALL first send one short fixed prompt to it. The test call SHALL send no conversation content. A passed test SHALL mark the Model check as tested. A failed test SHALL mark the Model check failed with the reason, with any key removed, and SHALL start no preview. A connected OpenCode model SHALL NOT be test-called from the page.

#### Scenario: The model test fails

- **WHEN** the external API rejects the test call
- **THEN** the Model check SHALL fail with the reason, with any key removed
- **AND** no preview SHALL start

#### Scenario: A second import on the same page

- **WHEN** the test passed earlier on this page and the user selects **Import new chats** again
- **THEN** no new test call SHALL be sent

### Requirement: Import all hosts chooses the hosts that have history

**Import all hosts** SHALL choose every host whose history is found on this computer and the checklist SHALL name each host it leaves out because no history was found. A chosen host whose reader cannot load SHALL fail the History found check with the step to untick that host in **Customise**. Such a host SHALL NOT be dropped without a word.

#### Scenario: Importing all hosts

- **WHEN** Pi and Claude Code have history on this computer, OpenCode does not, and the user selects **Import all hosts**
- **THEN** the preview SHALL cover Pi and Claude Code only
- **AND** the checklist SHALL say that OpenCode is left out because no history was found

#### Scenario: Pi history found but its reader is missing

- **WHEN** Pi history exists but the Pi session reader cannot load
- **THEN** the History found check SHALL fail for Pi and say to untick Pi in **Customise**
- **AND** **Import all hosts** SHALL be disabled until the user does so

### Requirement: The model line names the import model once

The import panel SHALL show one line that names the model the import uses, as the saved external API with its provider and model, or as a connected model name, followed by a **Change** link. **Change** SHALL open the **Customise** section and move focus to the import model choice. When the host's automatic import resolves to a different model, the same line SHALL say which model automatic import uses and where to change it. The main flow SHALL NOT show a second model picker.

#### Scenario: Both imports use the external API

- **WHEN** Pi's backfill model resolves to the saved external API `deepseek/deepseek-flash` and the import model is the saved external API
- **THEN** the line SHALL name `deepseek/deepseek-flash` once, with **Change**

#### Scenario: Changing the import model

- **WHEN** the user selects **Change**
- **THEN** the **Customise** section SHALL open and the import model choice SHALL receive focus

#### Scenario: Changing the model on the overview when the first host has no history

- **WHEN** Pi has no history, so its section in **Customise** is hidden, and the user selects **Change** on the overview
- **THEN** the import model choice of the first ticked host, OpenCode, SHALL receive focus

### Requirement: Customise holds the detailed import controls

A **Customise** section, closed by default, SHALL hold the output choices, the scope, **Show handled sessions**, the advanced options, the host choices on the overview, each host's session list with selection, the import model choice, and **Preview (dry run)** and **Start import**. **Start import** SHALL open the same confirm dialog as the primary button. The session list SHALL keep its existing rules for listing, selection, staleness and pinned previews.

#### Scenario: Choosing sessions by hand

- **WHEN** the user opens **Customise**, lists OpenCode sessions, ticks two and previews
- **THEN** **Start import** SHALL open the confirm dialog for those two sessions

### Requirement: Missing project folders are resolved in one place

When a preview or listing finds sessions whose project folder is missing, the import panel SHALL show one notice, for example `5 sessions skipped: folder missing. Resolve`. On a host view, **Resolve** SHALL open and focus that host's list of sessions that need a folder. On the overview, **Resolve** SHALL open the matching host view's list. The import options SHALL NOT offer a directory map text box. Saved directory maps and Smart resolve SHALL stay the only way to map a folder from the page.

#### Scenario: Resolving from the notice

- **WHEN** an OpenCode preview reports 5 sessions with missing folders and the user selects **Resolve**
- **THEN** the OpenCode list of sessions that need a folder SHALL open and its summary SHALL receive focus

#### Scenario: No map text box

- **WHEN** the user opens **Customise** and its advanced options
- **THEN** no directory map text box SHALL be shown

### Requirement: Re-analyse chat history opens the import panel

Selecting **Re-analyse chat history** on the Shared view SHALL open the overview with the **Import all hosts** panel and its **Customise** section open, and the forced profile-only options applied. The user SHALL still preview and confirm before any import starts.

#### Scenario: Re-analysing

- **WHEN** the user selects **Re-analyse chat history**
- **THEN** the overview SHALL show the open import panel with User profile ticked, Project memories unticked and Re-analyse handled history on
- **AND** no import SHALL start until the user confirms

### Requirement: A stale list at Import previews again

When the server refuses **Import** in the confirm dialog because the session list went out of date, the dialog SHALL close, and the page SHALL run the preview once more and open the dialog with the new numbers. When that happens a second time, the panel SHALL show one plain line that tells the user to select the primary button again, and SHALL NOT show the server's text.

#### Scenario: New chats arrive before Import

- **WHEN** the confirm dialog is open and a new session makes the server refuse **Import** as out of date
- **THEN** the dialog SHALL close, the preview SHALL run once more and the dialog SHALL open with the new numbers
- **AND** a second refusal SHALL show `New chats appeared. Select Import new chats again.` and no dialog

### Requirement: The model test result belongs to one model

The page SHALL keep each model test result with the provider, model and URL it tested, never the key. It SHALL treat a result for another provider, model or URL as untested, for a pass and for a fail. It SHALL send at most one test call per model per page load.

#### Scenario: The model changed after a test

- **WHEN** the test passed on this page, the user saves another external model in Settings and comes back in the same tab
- **THEN** the Model row SHALL read not tested and the next **Import new chats** SHALL send one new test call

### Requirement: The primary button runs one flow at a time

While a listing or preview runs, the primary button SHALL start nothing more. A listing or preview that fails SHALL end the busy line and show its reason.

#### Scenario: Two quick clicks

- **WHEN** the user selects **Import new chats** twice before the first listing returns
- **THEN** the page SHALL send one listing per host

#### Scenario: A listing fails

- **WHEN** the session listing fails while the flow runs
- **THEN** the busy line SHALL end, the reason SHALL show and the button SHALL be enabled again

### Requirement: The overview names and remembers the hosts it imports

Under **Import all hosts**, a line SHALL name the hosts the import will cover. The overview SHALL store the host choice in the browser only after the readiness check has ticked the hosts, or a saved choice was loaded, and the user has changed the choice.

#### Scenario: Naming the hosts

- **WHEN** Pi and OpenCode have history and Claude Code has none
- **THEN** the line SHALL read `Imports chats from Pi, OpenCode. It makes model calls and can cost money.`

#### Scenario: Leaving before readiness loads

- **WHEN** the user opens the overview and leaves before readiness loads
- **THEN** nothing SHALL be stored in the browser

### Requirement: The primary button never re-analyses

**Import new chats** and **Import all hosts** SHALL preview and import with **Re-analyse handled history** off, whatever **Customise** holds. A re-analyse SHALL run only from **Start import** in Customise, and its confirm dialog SHALL say that chats already imported are analysed again and can cost more model calls, in place of the line that they are skipped.

#### Scenario: Re-analyse handled history is ticked in Customise

- **WHEN** **Re-analyse handled history** is on in Customise and the user selects **Import new chats**
- **THEN** the preview and the import SHALL skip chats already imported
- **AND** the dialog SHALL say that imported chats are skipped

#### Scenario: A re-analyse from Customise

- **WHEN** the user previews with **Re-analyse handled history** on and selects **Start import**
- **THEN** the dialog SHALL say that chats already imported are analysed again and can cost more model calls
- **AND** it SHALL NOT say that imported chats are skipped

### Requirement: Import options stay with one view

The **Re-analyse chat history** preset SHALL apply to the overview visit it opens. A host view SHALL NOT receive it, and leaving the overview SHALL end it. **Customise** options SHALL belong to one host view: opening another host's view SHALL start from that host's default options.

#### Scenario: Show handled sessions on another host

- **WHEN** the user ticks **Show handled sessions** on the Pi view and then opens the OpenCode view
- **THEN** **Show handled sessions** SHALL be off on the OpenCode view

#### Scenario: Back on the overview after Re-analyse

- **WHEN** the user selects **Re-analyse chat history**, opens the Pi view, then returns to the overview
- **THEN** the overview SHALL show the normal import options and a closed Customise

### Requirement: The dialog counts only work the server runs

The server runs no host that has no sessions. Profile prompts that wait inside OMMS SHALL count as work only when a host has sessions to run. The confirm dialog SHALL name only the hosts the preview found sessions for, and the shared profile calls SHALL be timed with the first host that runs.

#### Scenario: Only waiting profile prompts

- **WHEN** the preview finds no session and 6 profile prompts waiting inside OMMS
- **THEN** the panel SHALL say **Nothing new to import**
- **AND** no dialog SHALL open

#### Scenario: A host with no work on the overview

- **WHEN** the overview preview finds sessions for Claude Code and none for Pi
- **THEN** the dialog SHALL name Claude Code only

### Requirement: Profile learning needs an email before an import

When the User profile output is on and profile learning has no email to name the profile (no profile email setting and no git `user.email` in the folder the import runs in), the checklist SHALL show a fourth row, **Profile**, that fails and says to set the email with `git config --global user.email` or to untick User profile. When the profile step still fails for this reason, the result SHALL say the same, never to refresh the preview.

#### Scenario: No email names the profile

- **WHEN** User profile is ticked and neither the profile email setting nor the git `user.email` is set
- **THEN** a **Profile** row SHALL fail and say what to set
- **AND** the import button SHALL be disabled

#### Scenario: The profile step fails for the email

- **WHEN** a run reaches the profile step with no email
- **THEN** the result SHALL say to set it with `git config --global user.email` and import again

### Requirement: The model check speaks plainly

A failed model test SHALL read as one plain sentence for its kind: key refused, model or address not found, service busy, service problem, service not reached, or another failure. Only the HTTP status code SHALL show, as small secondary text; the raw reply SHALL NOT show. **Customise** SHALL show the same model state as the Model row. While the model is untested, the panel SHALL say in one short line that the button checks the model with one short call first.

#### Scenario: The key is refused

- **WHEN** the external API rejects the test call with status 401
- **THEN** the Model row SHALL say that the model service did not accept the API key, with `Error code: 401` as secondary text

#### Scenario: Before the first test

- **WHEN** the model has not been tested on this page
- **THEN** the panel SHALL say that the button checks the model with one short call first

### Requirement: Counts read in the right number

The missing-folder notice SHALL read `1 session skipped: folder missing.` for one session, and the result SHALL read `Profile updated from 1 prompt` for one prompt.

#### Scenario: One session skipped

- **WHEN** one session has a missing folder
- **THEN** the notice SHALL read `1 session skipped: folder missing. Resolve`

### Requirement: The Profile learning row shows how learning behaves

The Profile learning row of `/memory/shared` SHALL show a settings table above the catch-up controls, with one row per learning behaviour. Six rows SHALL have a dropdown: no user email, fade old items, model input, check older items, notice when done, and during a catch-up run. Four rows SHALL show their fixed value as text: history entry, host model fails, reply check, and save clash. Each row SHALL show a plain name, one line of description, and the default.

#### Scenario: Opening the row

- **WHEN** the user opens the Profile learning row on `/memory/shared`
- **THEN** the table SHALL show ten rows
- **AND** the six dropdowns SHALL show the saved values, or the defaults when nothing is saved

#### Scenario: A narrow screen

- **WHEN** the page is 390 pixels wide
- **THEN** each row SHALL stack its name above its control without sideways scrolling

### Requirement: The learning dropdowns offer only behaviours that exist

Each dropdown SHALL offer only these options: no user email (Learn anyway, Skip), fade old items (Off, On), model input (Prompts with profile and guidance, Prompts only), check older items (Off, On), notice when done (On, Off), and during a catch-up run (Keep learning, Pause). The first option of each list SHALL be the default.

#### Scenario: The email row

- **WHEN** the user opens the no user email dropdown
- **THEN** it SHALL offer exactly Learn anyway and Skip

### Requirement: Learning settings save through the safe settings flow

**Save** SHALL write only the changed learning keys to the global config through the existing settings API, with its authentication, origin, validation, conflict and legacy-file rules. **Cancel** SHALL restore the saved values. Save SHALL be off while nothing changed or the settings view is read-only. A project config SHALL NOT be written. The page SHALL say that the settings apply to every host.

#### Scenario: Turning on decay

- **WHEN** the user sets fade old items to On and presses **Save**
- **THEN** the global config SHALL hold `"userProfileDecayBeforeMerge": true`
- **AND** every other key and comment SHALL be unchanged

#### Scenario: The file changed meanwhile

- **WHEN** another process changes the config file before the save
- **THEN** the save SHALL be refused without writing
- **AND** the section SHALL reload the values and ask the user to save again

### Requirement: Reset to default restores every learning default

The table SHALL offer **Reset to default**. After the user confirms, it SHALL remove the six learning keys from the global config through the same safe settings flow, so every row shows its default. Reset SHALL be off when none of the six keys is in the file.

#### Scenario: Resetting after changes

- **WHEN** the file holds `"userProfileWithoutEmail": "skip"` and `"userProfileValidationEnabled": true` and the user confirms **Reset to default**
- **THEN** both keys SHALL be removed from the global file
- **AND** the rows SHALL show Learn anyway and Off

#### Scenario: Nothing to reset

- **WHEN** none of the six keys is in the global file
- **THEN** **Reset to default** SHALL be off

### Requirement: The learning table works in every language

Every name, description, option and message in the learning table SHALL have Chinese and Arabic text. In Arabic the table SHALL use right-to-left layout, and config keys SHALL stay left-to-right.

#### Scenario: Arabic

- **WHEN** the language is Arabic and the user opens the Profile learning row
- **THEN** every label and option SHALL show in Arabic
- **AND** the config keys SHALL read left-to-right

### Requirement: Host and overview saves confirm first

On the host pages and the Memory overview these actions SHALL use the shared settings confirm dialog before they send a request: the host Save model, turning automatic import off, Use external API, Pause, Resume and Retry, Ignore on a folder row, and the opening context and compaction Save. The dialog content, Cancel and page checks SHALL follow the Settings rules. Turning automatic import on SHALL keep its existing dialog.

#### Scenario: Turn automatic import off

- **WHEN** the user clears "Import past chats automatically" for Pi
- **THEN** a confirm dialog opens, and Cancel leaves the box ticked

#### Scenario: Retry an import

- **WHEN** the user selects **Retry** on a host whose import failed
- **THEN** a confirm dialog says the retry calls the model again, and no run starts before the user confirms

#### Scenario: Use external API

- **WHEN** the user selects **Use external API** for OpenCode
- **THEN** a confirm dialog says OpenCode will use the external API model, and nothing is saved before the user confirms

#### Scenario: Opening context

- **WHEN** the user changes the opening context and selects **Save**
- **THEN** a confirm dialog lists the change and nothing is sent before the user confirms
