## MODIFIED Requirements

### Requirement: The page controls automatic import

The Settings page SHALL have an **Automatic import** section with a switch for `autoBackfill` and, for each host, a model choice for `opencodeBackfillModel` or `piBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model` chosen the same way as the host's capture model. For each host the section SHALL show the backfill state, including paused, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to that host's Directory maps list, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Run now, Pause, and Resume for each host. The counts SHALL refresh while a run is active. It SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running backfill after its current exchange. It SHALL say that automatic import makes model calls.

The switch and the section description SHALL stay above the host cards. Each host card SHALL be a keyboard-accessible disclosure. Its summary SHALL show the host name, the backfill state, the pending exchange count, and the unresolved session count. A card SHALL open by default when its host has a running or paused run, and SHALL be collapsed otherwise. A card that the user opened or closed SHALL keep that state while the counts refresh. Collapsing a card SHALL keep any unsaved model choice.

The Automatic import host headings SHALL NOT repeat the overall import-status pills shown in Import and backfill. Removing these pills SHALL NOT remove the operational state, last-run summary, unresolved counts, errors, or controls.

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

- **WHEN** no host has a running or paused run and the user opens the Settings page
- **THEN** the Pi, OpenCode, and Claude Code cards SHALL be collapsed
- **AND** each summary SHALL show the host's state, pending exchanges, and unresolved sessions

#### Scenario: A run is active

- **WHEN** a Pi backfill is running and the user opens the Settings page
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
- **THEN** OpenCode's Directory maps list SHALL open and its summary SHALL receive focus
- **AND** other hosts' drafts and disclosure states SHALL remain unchanged

### Requirement: Each host shows its import status

The Import and backfill section SHALL show a status badge for each host, derived from that host's latest backfill and import records:

- **Imported ✅** when the latest run finished with no pending exchanges and no unresolved sessions.
- **Partly imported** with the number of unresolved sessions when the latest run finished and some sessions are unresolved.
- **Running** while a run is active, and **Learning profile** while a finished run's profile step is active.
- **Paused**, **Failed** with the last error, or **Not started**, from the backfill state. A run that finished with some failed exchanges SHALL NOT show Failed, because those exchanges are retried at the next run.

The unresolved session count SHALL exclude sessions in directories listed in `importIgnoredDirectories`. The server SHALL apply this when it serves the backfill status, so every badge and card reads the same count.

A Partly imported badge SHALL be a keyboard-accessible link to that host's unresolved Directory maps list. Its visible wording and count SHALL remain present. Its accessible name SHALL identify the host and destination in the current page language. Activating it SHALL reveal the matching host list, scroll to it, and focus its summary without saving settings or starting an import. Other status badges SHALL remain informational.

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
- **THEN** Pi's Directory maps list SHALL open and its summary SHALL receive focus
- **AND** the browser SHALL scroll to that list without reloading the page
- **AND** the badge SHALL retain its wording and unresolved count

#### Scenario: A badge without unresolved sessions

- **WHEN** a host's badge shows Imported, Running, Learning profile, Paused, Failed, or Not started
- **THEN** it SHALL NOT become a link to unresolved directories solely because it is a status badge
