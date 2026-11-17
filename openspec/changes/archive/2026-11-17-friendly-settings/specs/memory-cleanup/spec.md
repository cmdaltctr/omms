# Spec Delta

## Purpose

Automatic memory cleanup deletes old unpinned memories. This capability makes deletion opt-in through one new key, makes sure an older config file never causes deletion, runs it the same way on every host, keeps unrelated housekeeping running, and tells the user what it would delete.

## ADDED Requirements

### Requirement: Only autoDeleteOldMemories turns on automatic deletion

OMMS SHALL delete memories and prompts by age automatically only when the global config sets `autoDeleteOldMemories` to `true`. The key SHALL default to `false`. A project config file SHALL NOT change it. The config template written on first run SHALL NOT set it, and SHALL show it commented out under a warning that it deletes memories.

#### Scenario: A new install

- **WHEN** OMMS starts with no config file
- **THEN** no host and no web app SHALL delete a memory or a prompt by age
- **AND** the created template SHALL NOT contain an active `autoDeleteOldMemories` or `autoCleanupEnabled` line

#### Scenario: The user turns deletion on

- **WHEN** the global config file sets `"autoDeleteOldMemories": true`
- **THEN** the daily run SHALL delete the unpinned memories older than `autoCleanupRetentionDays`

#### Scenario: A project tries to turn it on

- **WHEN** the global file has no `autoDeleteOldMemories` and a project file sets it to `true`
- **THEN** no memory SHALL be deleted by age

### Requirement: The old autoCleanupEnabled key deletes nothing

OMMS SHALL NOT read `autoCleanupEnabled` to decide whether to delete. A global or project file that sets it to `true` or `false` SHALL load with no error and no config problem, and SHALL NOT be rewritten. `autoCleanupRetentionDays` SHALL keep its meaning and validation.

#### Scenario: A file written by an older version

- **WHEN** the global file sets `"autoCleanupEnabled": true` and does not set `autoDeleteOldMemories`
- **THEN** the OpenCode idle run, the Pi settled-turn run and the web app daily run SHALL each delete no memory and no prompt
- **AND** the file SHALL remain unchanged

#### Scenario: Both keys set

- **WHEN** the global file sets `"autoCleanupEnabled": false` and `"autoDeleteOldMemories": true`
- **THEN** the daily run SHALL delete old unpinned memories

### Requirement: Automatic memory deletion runs the same on every host

When `autoDeleteOldMemories` is on, OpenCode, Pi and the web app SHALL each run deletion at most once a day per process. OpenCode SHALL run it after the idle capture, Pi after the settled-turn capture, and the web app on a daily timer, so Claude Code users get the same behaviour.

#### Scenario: Pi with deletion on

- **WHEN** deletion is on with 30 days and a Pi turn settles for the first time that day
- **THEN** OMMS SHALL delete the unpinned memories not updated in the last 30 days
- **AND** pinned memories SHALL remain

#### Scenario: Claude Code with deletion on

- **WHEN** deletion is on and the web app has run for a day while only Claude Code is used
- **THEN** the web app SHALL have run one deletion

### Requirement: One run deletes old prompts and their memories together

Each run SHALL delete the saved prompts older than `autoCleanupRetentionDays` and the unpinned memories, other than memorisations, whose last update is older than that, in every project of the active memory space. A memory captured from one of those old prompts SHALL go in the same run as its prompt, not a later one.

#### Scenario: A memory linked to an old prompt

- **WHEN** deletion is on with 30 days, and an unpinned memory and the prompt it was captured from are both older than 30 days
- **THEN** the first daily run SHALL delete both
- **AND** a second run that day or the next SHALL find nothing more to delete

### Requirement: Daily housekeeping runs whether deletion is on or off

Once a day per process, on OpenCode, Pi and the web app, OMMS SHALL remove capture attempt records older than `captureAttemptRetentionDays`, capture retry rows older than `captureRetryRetentionHours`, and expired cleanup undo records, and SHALL compact the prompt database. This housekeeping SHALL NOT depend on `autoDeleteOldMemories` or `autoCleanupEnabled`, and SHALL NOT delete memories or prompts.

#### Scenario: Attempt records with deletion off

- **WHEN** deletion is off, `captureAttemptRetentionDays` is 30, and attempt records 40 days old exist
- **THEN** the next daily housekeeping SHALL delete those records
- **AND** no memory SHALL be deleted

### Requirement: OMMS can count what a deletion would remove

OMMS SHALL count, without deleting anything, the memories that one deletion run with a given number of days would remove now. The count and the deletion SHALL use one selection function, so the count equals the number of memories that are gone when that run has finished. The count SHALL cover the active memory space only.

#### Scenario: Counting before turning it on

- **WHEN** 12 unlinked unpinned memories, 2 unpinned memories linked to old prompts and 3 pinned memories were last updated more than 30 days ago
- **THEN** the count for 30 days SHALL be 14
- **AND** no memory SHALL be deleted

#### Scenario: The count matches what goes

- **WHEN** the count for 30 days is N and deletion then runs with 30 days until it deletes nothing more
- **THEN** exactly N memories SHALL be gone, all in the first run
- **AND** pinned memories, memorisations and memories updated in the last 30 days SHALL remain

### Requirement: Each deletion run writes one log line with counts only

Each run that deletes at least one memory or prompt, automatic or from the manual Cleanup button, SHALL write one log line with the number of memories and prompts deleted, the retention days and the trigger. The line SHALL NOT contain memory text, memory ids, prompt text or project names.

#### Scenario: A daily run deletes old memories

- **WHEN** a daily run deletes 3 memories and 1 prompt with 30 days
- **THEN** the log SHALL have one line `Cleanup: old memories deleted` with `memories` 3, `prompts` 1, `retentionDays` 30 and `trigger` `daily`
- **AND** the line SHALL hold no text or id of the deleted rows and no project name

### Requirement: The manual Cleanup button keeps its own confirmation

The **Cleanup** button on the memory list SHALL keep its current behaviour: after the user confirms, it SHALL delete unpinned memories and prompts older than `autoCleanupRetentionDays`, with the same selection as the daily run, and run the housekeeping, whatever `autoDeleteOldMemories` says. Its confirmation SHALL say that pinned memories and memorisations stay. It SHALL NOT run without that confirmation.

#### Scenario: The user cancels

- **WHEN** the user presses Cleanup and cancels the confirmation
- **THEN** no memory SHALL be deleted
