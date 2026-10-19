## ADDED Requirements

### Requirement: A run with failed units reports the failed count and the safe retry

When a child ends with one or more failed memory units, its message SHALL state that some memory units failed, SHALL state that completed work is saved, and SHALL state that a new preview and import retries only the failed units. The message SHALL be fixed text with no number, so that each language table can translate it. The finish dialog SHALL show the number of failed units on a separate line, taken from the child's counts. The child and group state SHALL stay "failed" and later children SHALL stay not-run, as the existing failure rule requires. The message SHALL NOT include model replies or conversation text.

#### Scenario: One unit failed out of many

- **WHEN** Pi finishes with 1,717 units done and 1 failed
- **THEN** the message SHALL say some memory units failed, completed work is saved, and a new preview and import retries only the failed units
- **AND** the finish dialog SHALL show 1 failed memory unit on its own line
- **AND** Pi and the group state SHALL be failed

#### Scenario: Profile learning failed

- **WHEN** a child fails in profile learning with no failed memory units
- **THEN** the message SHALL say profile learning failed and completed memory work is saved

#### Scenario: Another language

- **WHEN** the page language is not English and a child ends with failed memory units
- **THEN** the message SHALL show in that language, with the failed count on its own line

### Requirement: The session list hides handled sessions by default

The session list SHALL decide whether a session is handled from the import ledger and the outputs the user ticked. For each ticked output, the session SHALL pass when the ledger has at least one row of that output's kind for the session and every such row is imported or skipped. Memory rows count for Project memories, and profile rows count for User profile. A session SHALL be handled only when it passes for every ticked output. A session with a failed or in-progress row of a ticked kind, with no row of a ticked kind, or with no session id, SHALL NOT be handled.

The list SHALL hide handled sessions by default and SHALL offer a "Show handled sessions" option that shows them marked as handled. Turning on "Re-analyse handled history" SHALL also show them. Changing the ticked outputs or either option SHALL reload the list and clear the selection. The total and the pages SHALL count only the sessions shown, and the list SHALL state how many handled sessions are hidden. Select all matching SHALL apply only to the sessions shown, and the server SHALL apply the same rule when it resolves that selection. The check SHALL read the ledger only, SHALL NOT read session transcripts, and SHALL NOT create or write the ledger. Preview and import SHALL still decide pending work from the units themselves.

#### Scenario: After a finished import

- **WHEN** only Project memories is ticked, every memory unit of 386 Pi sessions is imported or skipped, and the user lists sessions
- **THEN** the list SHALL show no rows and SHALL say 386 handled sessions are hidden

#### Scenario: One unit failed

- **WHEN** one session has a failed memory row and the rest are imported
- **THEN** the list SHALL show that session and hide the others

#### Scenario: Profile not yet collected

- **WHEN** a session has all its memory rows imported and no profile rows, and the user ticks both outputs
- **THEN** the list SHALL show that session

#### Scenario: Profile only

- **WHEN** only User profile is ticked and a session has all its profile rows imported
- **THEN** the list SHALL hide that session, whatever its memory rows say

#### Scenario: Showing handled sessions

- **WHEN** the user turns on "Show handled sessions"
- **THEN** handled sessions SHALL appear marked as handled
- **AND** Select all matching SHALL still count only the sessions shown

#### Scenario: Re-analyse handled history

- **WHEN** the user turns on "Re-analyse handled history"
- **THEN** handled sessions SHALL appear marked as handled without the "Show handled sessions" option

#### Scenario: Select all matching with hidden sessions

- **WHEN** the user selects all matching sessions while handled sessions are hidden, and starts an import
- **THEN** the import SHALL NOT include any hidden handled session

#### Scenario: A session gained turns after import

- **WHEN** a handled session has new turns that the ledger does not yet record
- **THEN** the list MAY still hide it
- **AND** Preview SHALL still report the new turns as pending work

#### Scenario: A missing ledger

- **WHEN** the ledger file or table does not exist
- **THEN** no session SHALL be marked handled and the ledger SHALL NOT be created by listing
