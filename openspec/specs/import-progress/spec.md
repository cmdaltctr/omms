# import-progress Specification

## Purpose

Show how far every history import has progressed and how long it has left, whether it runs as an automatic backfill, from the web page, or from the terminal, and let the user start, pause, and resume each host's backfill from the Settings page.

## Requirements

### Requirement: Every import run records its progress

Each import run that makes model calls, whether an automatic backfill, a web import, or a CLI or slash-command import, SHALL record a progress entry in the memory store. The entry SHALL hold the host, the surface that started it, the state (running, paused, stopped, done, or failed), the start time, the total number of memory units and profile batches to process, the number processed so far with imported, skipped, and failed counts, the last update time, and the last error with secrets removed. The total SHALL count only units that need a model call, not units already in the ledger. For an automatic backfill, and for Run now and Resume, the total SHALL be the backfill's dry-run count, known before the first model call. For a CLI, slash-command, or web import, which has no dry run, the total SHALL start from the units found and SHALL be refined as the run passes units already in the ledger. The entry SHALL NOT contain prompts, replies, or other conversation content. Dry runs SHALL NOT record progress entries. A run that stops without updating its entry SHALL be shown as stopped once its owning process is gone. The Memory page SHALL display these records; grouped web imports SHALL retain one such record for each child rather than inventing an All hosts identity in the store.

#### Scenario: A CLI import is visible on the page

- **WHEN** the user runs `om-memory-system import-pi-history` in a terminal and opens Memory
- **THEN** the page SHALL show that Pi import as running, started from the CLI, with its counts

#### Scenario: Most units are already imported

- **WHEN** a Pi backfill finds 736 units, of which 729 are already in the ledger
- **THEN** the page SHALL show a total of 7 and count only those 7 as pending

#### Scenario: The terminal is closed during a CLI import

- **WHEN** the CLI process ends without finishing its run
- **THEN** the page SHALL show that run as stopped
- **AND** rerunning the same command SHALL continue from the ledger

### Requirement: Progress shows percentage and time left

For a running import, the Memory page SHALL show a progress bar, the percentage done, the number done out of the total, and the estimated minutes left. The estimate SHALL be computed from the processing rate over the recent part of the run, not from the whole run, and SHALL be shown as unknown until enough units have finished to measure a rate. The values SHALL refresh without a page reload while the run is active.

#### Scenario: Watching a long import

- **WHEN** 400 of 1,000 units are done and the recent rate is 5 units a minute
- **THEN** the page SHALL show 40%, 400 of 1,000, and about 120 minutes left

#### Scenario: A run has just started

- **WHEN** fewer units than needed to measure a rate have finished
- **THEN** the time left SHALL be shown as unknown

### Requirement: The user can run, pause, and resume a host's backfill

A host view's status header SHALL offer **Pause** while the host's backfill runs or waits to run, **Resume** while it is paused or was cut short with exchanges pending, and **Retry** after it failed. The page SHALL NOT offer **Run now**. Resume and Retry SHALL start that host's backfill at once, with the same cutoff, maps, model rule, ledger, and one-run-per-host lock as an automatic backfill, whether or not `autoBackfill` is on. They SHALL be available in the login web app and in `om-memory-system web` without Pi or OpenCode open when the host's backfill model resolves to the external API, and SHALL otherwise say which model setting they need. Pause SHALL stop the run after its current exchange and record the paused state. A paused backfill SHALL NOT start automatically at a host start until the user resumes it. Resume SHALL clear the paused state and start the run, continuing from the ledger. Resume and Retry SHALL be refused, with the reason, while another import for the same host runs. These controls SHALL follow the same origin and authentication rules as other Settings changes.

#### Scenario: Running a backfill with no host open

- **WHEN** the login web app runs, Pi is closed, `piBackfillModel` is `external`, Pi's backfill is paused, and the user selects Resume for Pi
- **THEN** the Pi backfill SHALL start in the web app's process and its progress SHALL be shown

#### Scenario: Pausing across a restart

- **WHEN** the user pauses the OpenCode backfill and later starts OpenCode
- **THEN** no OpenCode backfill SHALL start
- **AND** the page SHALL show it as paused until the user selects Resume

#### Scenario: A second run for the same host

- **WHEN** a Pi CLI import is running and the user selects Retry for a failed Pi backfill
- **THEN** the page SHALL refuse with the reason that a Pi import is already running

#### Scenario: No usable model outside a host

- **WHEN** the login web app runs and the Pi backfill model is a Pi signed-in model
- **THEN** Resume and Retry for Pi SHALL be unavailable
- **AND** the page SHALL say to open Pi or choose the external API for Pi's backfill

### Requirement: The profile step of a run is shown as its own phase

When every exchange of a running import is done and the run is still learning the profile from imported prompts, the run record SHALL say so, and the Memory page SHALL show **Learning profile** with the number of profile batches done out of the total in place of the exchange progress bar. When the profile step ends, the run SHALL be recorded as done or failed as before. A grouped import SHALL show the active child's phase and SHALL not mark it complete while its profile step still runs.

#### Scenario: Profile step after the last exchange

- **WHEN** a Claude Code run has finished 6 of 6 exchanges and is on profile batch 2 of 3
- **THEN** the page SHALL show Learning profile, 2 of 3
- **AND** SHALL NOT show a full exchange progress bar

#### Scenario: Profile step ends

- **WHEN** the last profile batch of that run finishes
- **THEN** the run SHALL be recorded as done and the page SHALL show the last run summary

### Requirement: A grouped import shows the current host and separate results

A grouped import SHALL show queued, active, completed, failed, cancelled, no-work, and not-run hosts as applicable, the current host and phase, and separate results plus combined counts. Memory units and profile batches SHALL be labelled separately. A memory-extraction percentage SHALL not imply the group's profile work is complete.

#### Scenario: Progress through three hosts

- **WHEN** Pi is complete, OpenCode is learning the profile, and Claude Code has not started
- **THEN** the page SHALL show Pi complete, OpenCode active in profile learning, and Claude Code queued
- **AND** it SHALL show OpenCode's profile batch progress

#### Scenario: One host failed

- **WHEN** OpenCode fails after Pi completed
- **THEN** Pi's result SHALL remain visible and Claude Code SHALL be shown as not run
- **AND** the combined result SHALL be unsuccessful with OpenCode's reason

#### Scenario: A grouped preview

- **WHEN** preview succeeds for selected hosts
- **THEN** the page SHALL show each host's session and pending-work counts plus combined totals
- **AND** memory work and profile analysis estimates SHALL remain distinct

### Requirement: A real import shows a progress bar on the Sessions card

While a web import that is not a preview runs, the import panel SHALL show a progress bar for the active host. The bar SHALL show the host name, the step in plain words (**Saving memories**, **Skill turns** or **Learning your profile**), the done count out of the total, and the minutes left from that host's run record, or unknown until the record has measured a rate. Until the first count arrives, the bar SHALL show only the host and the step, never `0 / 0 · 0%`. The values SHALL refresh without a page reload. The button that cancels SHALL read **Stop after the current step**. The exact counters (memory units, profile batches) SHALL stay under **Details**. A preview SHALL NOT show the bar.

#### Scenario: Memory extraction is running

- **WHEN** Pi is extracting memory units, 400 of 1,000 units are done and Pi's run record gives about 120 minutes left
- **THEN** the panel SHALL show a bar at 40% labelled with Pi, Saving memories, 400 of 1,000, and about 120 minutes left

#### Scenario: The rate is not known yet

- **WHEN** a web import has just started and its run record has no rate
- **THEN** the time left SHALL read unknown

#### Scenario: Profile learning is running

- **WHEN** the active host is learning the profile and 2 of 4 batches are done
- **THEN** the bar SHALL show 50% labelled as Learning your profile, 2 of 4
- **AND** the memory-unit percentage SHALL NOT be shown as the group's progress

#### Scenario: A preview runs

- **WHEN** the user runs a preview, from the primary button or from **Customise**
- **THEN** the panel SHALL NOT show the progress bar

### Requirement: The end of a real import is announced

When a real import ends while the user is on the page, the page SHALL open a dialog with the result. The dialog SHALL show up to three plain lines summed over the hosts, each true for the run: memories saved (memory units imported); profile updated from N prompts (from 1 prompt for one) only when the profile step recorded prompts, or that profile learning failed; and the failed memory units when any failed, "Nothing failed." when nothing did, or that the import stopped before it finished when it stopped with no reason. It SHALL NOT show "Profile updated from 0 prompts", and SHALL NOT show "Failed: 0". A successful run SHALL say "Import successful 🎉" in English. A failed run SHALL name the host and the reason and say what to do next. When anything failed, the dialog SHALL offer **Retry failed**, which SHALL start the same preview and confirm flow as the primary button for the same hosts, and on a host view for that host only; the ledger SHALL make it retry only the work that did not finish. The dialog SHALL have a **Details** section, closed by default, that shows the existing per-host counters and reports, and an **OK** button. A cancelled run SHALL show a neutral message and SHALL NOT open the dialog. After the user clicks OK, the page SHALL reload its import data without a full browser reload, and the user's selection and options SHALL stay. The 🎉 SHALL appear only in the English text.

#### Scenario: Import finishes on the page

- **WHEN** a real import of Pi and OpenCode reaches done with 42 memory units imported, 120 prompts recorded for the profile and 0 failed
- **THEN** a dialog SHALL open saying "Import successful 🎉"
- **AND** it SHALL show 42 memories saved, profile updated from 120 prompts, and that nothing failed
- **AND** after OK the import data SHALL reload and the session list and selection SHALL stay

#### Scenario: Import fails on the page

- **WHEN** a real import reaches failed while the user views the Memory page
- **THEN** the dialog SHALL name the failing host and the reason and SHALL NOT say "successful"
- **AND** when memory units failed, the dialog SHALL show the failed count on its own line
- **AND** the dialog SHALL offer **Retry failed**

#### Scenario: Retrying failed work

- **WHEN** 3 memory units failed and the user selects **Retry failed**
- **THEN** the page SHALL preview the same hosts and open the confirm dialog
- **AND** units already imported SHALL be reported as already handled

#### Scenario: Retrying from a host view after an all-hosts run

- **WHEN** an all-hosts run failed and the user selects **Retry failed** on `/memory/pi`
- **THEN** the page SHALL list and preview Pi only

#### Scenario: The profile step failed

- **WHEN** a run saved 2 memories, no unit failed and profile learning failed
- **THEN** the dialog SHALL say that profile learning failed
- **AND** it SHALL NOT show "Profile updated from 0 prompts" or "Failed: 0"

#### Scenario: Reading the details

- **WHEN** the user opens **Details** in the dialog
- **THEN** the per-host counters SHALL show as they did before this change

#### Scenario: Another language

- **WHEN** the page language is not English
- **THEN** the success message SHALL be shown without the 🎉

#### Scenario: Cancelled run

- **WHEN** the user cancels a real import and it stops
- **THEN** the panel SHALL show a neutral cancelled message and no dialog

### Requirement: A result that finished while the user was away is shown on return

If a real import ended while the Memory page was not open, the page SHALL show a banner with the result the next time it opens, until the user dismisses it. Dismissing SHALL be remembered for that run only. The banner SHALL NOT show for a preview.

#### Scenario: Returning after a run ended

- **WHEN** a real import finished while the user was on another page
- **THEN** opening the Memory page SHALL show a banner with the result and a dismiss control
- **AND** no dialog SHALL open

#### Scenario: Dismissed banner

- **WHEN** the user dismisses the banner for a run
- **THEN** it SHALL NOT show again for that run, and SHALL show for a later run
