# import-progress Specification

## Purpose

Show how far every history import has progressed and how long it has left, whether it runs as an automatic backfill, from the web page, or from the terminal, and let the user start, pause, and resume each host's backfill from the Settings page.

## Requirements

### Requirement: Every import run records its progress

Each import run that makes model calls, whether an automatic backfill, a web import, or a CLI or slash-command import, SHALL record a progress entry in the memory store. The entry SHALL hold the host, the surface that started it, the state (running, paused, stopped, done, or failed), the start time, the total number of memory units and profile batches to process, the number processed so far with imported, skipped, and failed counts, the last update time, and the last error with secrets removed. The total SHALL count only units that need a model call, not units already in the ledger. For an automatic backfill, and for Run now and Resume, the total SHALL be the backfill's dry-run count, known before the first model call. For a CLI, slash-command, or web import, which has no dry run, the total SHALL start from the units found and SHALL be refined as the run passes units already in the ledger. The entry SHALL NOT contain prompts, replies, or other conversation content. Dry runs SHALL NOT record progress entries. A run that stops without updating its entry SHALL be shown as stopped once its owning process is gone.

#### Scenario: A CLI import is visible on the page

- **WHEN** the user runs `om-memory-system import-pi-history` in a terminal and opens the Settings page
- **THEN** the page SHALL show that Pi import as running, started from the CLI, with its counts

#### Scenario: Most units are already imported

- **WHEN** a Pi backfill finds 736 units, of which 729 are already in the ledger
- **THEN** the page SHALL show a total of 7 and count only those 7 as pending

#### Scenario: The terminal is closed during a CLI import

- **WHEN** the CLI process ends without finishing its run
- **THEN** the page SHALL show that run as stopped
- **AND** rerunning the same command SHALL continue from the ledger

### Requirement: Progress shows percentage and time left

For a running import, the Settings page SHALL show a progress bar, the percentage done, the number done out of the total, and the estimated minutes left. The estimate SHALL be computed from the processing rate over the recent part of the run, not from the whole run, and SHALL be shown as unknown until enough units have finished to measure a rate. The values SHALL refresh without a page reload while the run is active.

#### Scenario: Watching a long import

- **WHEN** 400 of 1,000 units are done and the recent rate is 5 units a minute
- **THEN** the page SHALL show 40%, 400 of 1,000, and about 120 minutes left

#### Scenario: A run has just started

- **WHEN** fewer units than needed to measure a rate have finished
- **THEN** the time left SHALL be shown as unknown

### Requirement: The user can run, pause, and resume a host's backfill

The Settings page SHALL offer **Run now**, **Pause**, and **Resume** for each host's backfill. Run now SHALL start that host's backfill at once, with the same cutoff, maps, model rule, ledger, and one-run-per-host lock as an automatic backfill. It SHALL be available in the login web app and in `om-memory-system web` without Pi or OpenCode open when the host's backfill model resolves to the external API, and SHALL otherwise say which model setting it needs. Pause SHALL stop the run after its current exchange and record the paused state. A paused backfill SHALL NOT start automatically at a host start until the user resumes it. Resume SHALL clear the paused state and start the run, continuing from the ledger. Run now SHALL be refused, with the reason, while another import for the same host runs. These controls SHALL follow the same origin and authentication rules as other Settings changes.

#### Scenario: Running a backfill with no host open

- **WHEN** the login web app runs, Pi is closed, `piBackfillModel` is `external`, and the user clicks Run now for Pi
- **THEN** the Pi backfill SHALL start in the web app's process and its progress SHALL be shown

#### Scenario: Pausing across a restart

- **WHEN** the user pauses the OpenCode backfill and later starts OpenCode
- **THEN** no OpenCode backfill SHALL start
- **AND** the page SHALL show it as paused until the user clicks Resume

#### Scenario: A second run for the same host

- **WHEN** a Pi CLI import is running and the user clicks Run now for Pi
- **THEN** the page SHALL refuse with the reason that a Pi import is already running

#### Scenario: No usable model outside a host

- **WHEN** the login web app runs and the Pi backfill model is a Pi signed-in model
- **THEN** Run now for Pi SHALL be unavailable
- **AND** the page SHALL say to open Pi or choose the external API for Pi's backfill
