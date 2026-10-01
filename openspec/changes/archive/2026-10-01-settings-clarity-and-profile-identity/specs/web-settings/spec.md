# Spec Delta

## ADDED Requirements

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

The Import and backfill section SHALL show a status badge for each host, derived from that host's latest backfill and import records:

- **Imported ✅** when the latest run finished with no pending exchanges and no unresolved sessions.
- **Partly imported** with the number of unresolved sessions when the latest run finished and some sessions are unresolved.
- **Running** while a run is active, and **Learning profile** while a finished run's profile step is active.
- **Paused**, **Failed** with the last error, or **Not started**, from the backfill state. A run that finished with some failed exchanges SHALL NOT show Failed, because those exchanges are retried at the next run.

#### Scenario: All Claude Code history is in

- **WHEN** the latest Claude Code run finished with 0 pending exchanges and 0 unresolved sessions
- **THEN** the Claude Code badge SHALL show Imported ✅

#### Scenario: Unresolved sessions remain

- **WHEN** the latest OpenCode run finished and 6 sessions are unresolved
- **THEN** the OpenCode badge SHALL show Partly imported with 6 unresolved

### Requirement: Automatic import shows the last run when no run is active

When no run is active for a host, the Automatic import card SHALL NOT show a progress bar. It SHALL show a summary of the latest run: its finish time, how it was started (automatic, Run now, or terminal), and its imported, skipped, and failed counts. The card's counts and the summary SHALL come from the same run record, so they agree.

#### Scenario: After a run finishes

- **WHEN** a Claude Code run finished at 20:35 with 6 imported, 0 skipped, and 0 failed, and the user reloads the page
- **THEN** the card SHALL show no progress bar
- **AND** SHALL show the finish time 20:35 and the counts 6, 0, and 0
