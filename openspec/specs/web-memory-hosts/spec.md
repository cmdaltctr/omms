# web-memory-hosts Specification

## Purpose

Let a user see and act on one host at a time. The Memory page shows a card for each host and for the settings they share. A host view holds that host's status, one main action, sessions, folders that need a map and settings. A host avatar can be changed, and the cards warn when memories cannot be saved.

## Requirements

### Requirement: The Memory overview shows one card per host and a Shared card

`/memory` SHALL show four cards of equal size in this order: Pi, OpenCode, Claude Code and Shared. Each host card SHALL show the host's avatar, its name and one status line built from that host's import, backfill and live capture state. A host that is set up, not paused and not failed SHALL read `Running`, followed by the date of its last history import and the time of its last live save when each is known, for example `Running · history imported 19 Oct · last saved today 18:52`. A paused host SHALL read for example `Paused · 0 pending`. The Shared card SHALL say that its settings apply to every host. Activating a card SHALL open its view. Below the cards, an **Import all hosts** action SHALL open the multi-host import and SHALL say that it makes model calls that can cost money. On a viewport narrower than 640 px the cards SHALL form a two-column grid without horizontal scrolling.

#### Scenario: Opening the overview

- **WHEN** the user opens `/memory`
- **THEN** the page SHALL show the Pi, OpenCode, Claude Code and Shared cards in that order
- **AND** each host card SHALL show a status line for that host

#### Scenario: A host that finished its last run

- **WHEN** OpenCode is set up, not paused, not failed, and its last run ended with nothing pending
- **THEN** the OpenCode card SHALL read `Running` and SHALL show the date of the history import as a second detail, for example `history imported 19 Oct`
- **AND** the card SHALL NOT read only `Imported` with a date

#### Scenario: Opening a host from the overview

- **WHEN** the user activates the OpenCode card with a pointer or with Enter or Space
- **THEN** the page SHALL navigate to `/memory/opencode`

#### Scenario: Phone width

- **WHEN** the viewport is 390 px wide
- **THEN** the cards SHALL show as two rows of two
- **AND** the page SHALL NOT scroll horizontally

### Requirement: A host view shows only that host

`/memory/pi`, `/memory/opencode` and `/memory/claude-code` SHALL show only the named host's content: a status header, the host's session list and the host's own settings (backfill model, import model and automatic import). A compact card switcher SHALL stay at the top with the current host marked, and SHALL include Shared. The same switcher SHALL stay at the top of the Shared view, with Shared marked. The chosen view SHALL survive a reload, and the browser Back action SHALL return to the previous view. A host view SHALL NOT show another host's sessions, models or state.

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

### Requirement: The status header has one main action and explains it

A host view's status header SHALL show the state (running, paused, stopped, failed or not set up), the pending count, the last run time with its outcome, and the model in use. Automatic import runs all the time, so a host that is set up, not paused and not failed SHALL show the state **Running**, whether or not a run is in progress. The header SHALL show exactly one main action whose label follows the state: **Pause** while running, **Resume** while paused, **Retry** after a failure, and **Resume** after a run was cut short with exchanges still pending. The header SHALL NOT offer **Run now**. The state **Stopped** SHALL show only when a run was cut short. Under the action, one sentence SHALL say what the last run did or why the action is unavailable. When the action is unavailable because the backfill model needs the host open, the sentence SHALL say so and offer a control that switches that host's backfill model to the saved external API. The header SHALL say that running an import makes model calls.

#### Scenario: Running with nothing to import

- **WHEN** a host is set up, not paused and not failed, and its last run ended with nothing pending
- **THEN** the state SHALL read **Running** and the main action SHALL read **Pause**
- **AND** the sentence SHALL say that automatic import is on and nothing is waiting

#### Scenario: A host that never ran

- **WHEN** a host is set up, not paused and not failed, and no import has run yet
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
- **AND** it SHALL point to the session list for newer chats

#### Scenario: A run cut short with exchanges pending

- **WHEN** a run was cut short and exchanges are still pending
- **THEN** the state SHALL read **Stopped** and the main action SHALL read **Resume**

#### Scenario: A failed run

- **WHEN** the last backfill run failed
- **THEN** the main action SHALL read **Retry**
- **AND** the sentence SHALL give the failure reason with any key redacted

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
