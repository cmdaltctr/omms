# multi-host-import Specification

## Purpose

Let users preview and import selected Pi, OpenCode, and Claude Code histories as one server-owned run while preserving each host's source, model rules, ledger, and results.

## Requirements

### Requirement: A grouped web import keeps each host distinct

A web import SHALL accept one or more distinct supported hosts with a source and pinned session selection for each. All hosts SHALL select Pi, OpenCode, and Claude Code. Shared scope, dates, output choices, and force options SHALL apply to every child. Existing single-host requests and CLI or in-session commands SHALL remain valid.

#### Scenario: Importing all three histories

- **WHEN** the user starts an All hosts import after preview and confirmation
- **THEN** the server SHALL create one grouped run containing Pi, OpenCode, and Claude Code
- **AND** each child SHALL retain its host-specific source and selection identity

#### Scenario: Existing single-host callers

- **WHEN** a caller submits the existing single-host web request
- **THEN** it SHALL retain its accepted request and response fields and single-host behaviour
- **AND** selecting no output SHALL still be rejected

#### Scenario: Invalid host selection

- **WHEN** a grouped request has no hosts, duplicate hosts, an unsupported host, or invalid child options
- **THEN** the server SHALL refuse the request before starting work

### Requirement: The entire group is checked before paid work starts

Before paid work starts, the server SHALL validate every child's source, pinned selection, options, and model readiness. A stale or unavailable child SHALL block the group with a host-specific reason. Zero matching sessions SHALL be reported as no work. The user SHALL explicitly remove an unavailable host or fix it; it SHALL not be silently omitted.

#### Scenario: One host has a stale selection

- **WHEN** Claude Code's session selection changes after preview while Pi and OpenCode still match
- **THEN** the server SHALL refuse the grouped start and identify Claude Code
- **AND** no child SHALL make a model call or write imported data

#### Scenario: One reader is unavailable

- **WHEN** Pi's reader cannot be loaded
- **THEN** preview SHALL show Pi as unavailable with an action to take
- **AND** a grouped run including Pi SHALL not start
- **AND** the user SHALL be able to deselect Pi and preview the other hosts

#### Scenario: A host has no matching history

- **WHEN** OpenCode's source is valid and its matching session count is zero
- **THEN** the grouped report SHALL show OpenCode as no work
- **AND** other selected hosts SHALL remain eligible

### Requirement: Preview is read-only and pinned per host

A grouped preview SHALL make no model calls or memory-store writes. Each child SHALL preserve its own listing revision, source identity, selected keys, and listing-time turn cutoff. It SHALL report per-host counts and combined totals without conversation content. OpenCode snapshot reuse and cleanup SHALL keep their existing rules.

#### Scenario: A selected session gains new turns

- **WHEN** a selected Pi session gains turns after listing
- **THEN** preview and import SHALL both exclude turns after its recorded listing time
- **AND** the Pi result SHALL report the held-back turns

#### Scenario: Two hosts have the same session identifier

- **WHEN** Pi and Claude Code both have a session identifier with the same text
- **THEN** their selections, results, and ledger work SHALL remain separate by host

#### Scenario: Preview without a ready external API

- **WHEN** the external API is incomplete but all selected history readers and sources are available
- **THEN** preview SHALL still return the work counts and model blocker
- **AND** it SHALL make no model calls

### Requirement: Profile analysis estimates count the shared backlog once

A grouped preview SHALL distinguish newly scheduled history prompts from prompts already waiting inside OMMS. Its profile analysis-call estimate SHALL exclude trivial prompts, deduplicate overlapping prompt identities, and count the existing waiting backlog once. It SHALL identify analysis calls as an estimate, with possible additional matching, deduplication, or retry calls.

#### Scenario: The same waiting prompt also appears in history

- **WHEN** a stored waiting prompt is also eligible in one selected history source
- **THEN** the combined profile estimate SHALL count that prompt once

#### Scenario: Multiple children share the waiting backlog

- **WHEN** 100 stored prompts wait and all three hosts are selected
- **THEN** the combined estimate SHALL include those 100 prompts once rather than three times
- **AND** it SHALL show the shared backlog separately from newly scheduled history prompts

### Requirement: Children run sequentially in the server

The server SHALL run selected hosts in the order Pi, OpenCode, then Claude Code, omitting deselected hosts. It SHALL finish a child's memory and profile steps before starting the next. A browser reload or navigation away SHALL not start another child or stop the server-owned group. Groups and single-host jobs SHALL share the one-web-job slot.

#### Scenario: Waiting for the profile step

- **WHEN** Pi finishes memory extraction but its profile step still runs
- **THEN** OpenCode SHALL remain queued until Pi's profile step ends

#### Scenario: Navigating away and returning

- **WHEN** the user leaves Memory during a grouped import and later returns or reloads
- **THEN** the page SHALL show the current group and per-host progress
- **AND** it SHALL not resubmit the import

#### Scenario: Starting a competing web job

- **WHEN** a grouped preview or import is running and a caller starts another grouped or single-host web job
- **THEN** the server SHALL refuse the second job with `409`
- **AND** the existing group SHALL keep running

### Requirement: Host model rules remain unchanged

Each child SHALL use a model valid for that host under existing web-import rules. Claude Code SHALL always use the saved external API. Pi and OpenCode SHALL retain their existing web model choices. A shared saved-external-API choice SHALL be available for all three. Selecting All hosts SHALL not save or change any capture or automatic-import model setting.

#### Scenario: All hosts use the external API

- **WHEN** the saved external API is complete and selected for every host
- **THEN** each child SHALL use it for the chosen import outputs
- **AND** live capture model settings SHALL remain unchanged

#### Scenario: A signed-in model is requested for Claude Code

- **WHEN** a grouped request assigns Claude Code a signed-in host model
- **THEN** the request SHALL be refused before paid work starts
- **AND** the message SHALL identify Claude Code's external API requirement

### Requirement: Failure and cancellation preserve completed work

A thrown error or a reported failed memory unit or profile step SHALL make that child and the group unsuccessful. Later children SHALL not start. Cancelling SHALL stop at the current child's safe boundary and cancel queued children. Completed children SHALL retain their results and ledger progress. Errors SHALL identify the host without secrets or conversation text.

#### Scenario: A report contains failed work

- **WHEN** Pi's importer returns a report with a failed unit or profile error
- **THEN** Pi and the group SHALL be shown as failed
- **AND** OpenCode and Claude Code SHALL be shown as not run
- **AND** successful Pi work SHALL remain recorded

#### Scenario: The second child throws

- **WHEN** Pi finishes successfully and OpenCode throws an error
- **THEN** Pi's completed result SHALL remain visible
- **AND** Claude Code SHALL not start
- **AND** the group SHALL identify OpenCode's failure

#### Scenario: Cancelling while a child runs

- **WHEN** the user cancels while OpenCode runs after Pi completed
- **THEN** Pi's result SHALL remain complete
- **AND** OpenCode SHALL stop using the existing safe-boundary cancellation rules
- **AND** Claude Code SHALL not start

#### Scenario: Cancelling before the first child

- **WHEN** cancellation arrives while the group is preparing its first child
- **THEN** no child SHALL begin model work after cancellation
- **AND** all preparation resources SHALL be released

### Requirement: Reruns reuse the shared import ledger

A later run SHALL use the existing host-specific memory and profile ledgers to skip finished work and retry failed or waiting work. A group SHALL not create a second identity for a host's session or forced profile replay. After a web server restart, the user SHALL start a fresh preview; abandoned queued work SHALL not restart automatically.

#### Scenario: Retrying a partially finished group

- **WHEN** Pi finished, OpenCode failed, and the user previews and starts the same group again
- **THEN** finished Pi work SHALL be reported as already handled
- **AND** OpenCode's failed or waiting work and Claude Code's untouched work SHALL be eligible

#### Scenario: Repeating forced profile-only analysis

- **WHEN** an earlier forced group already re-analysed a history prompt
- **THEN** a later forced group SHALL skip that prompt under the existing forced replay identity
- **AND** its support SHALL not be increased by replaying the same prompt again

#### Scenario: Restart during a group

- **WHEN** the web server stops during OpenCode after Pi finished
- **THEN** completed ledger work SHALL survive
- **AND** a restarted server SHALL not automatically launch OpenCode or Claude Code
- **AND** a fresh preview and confirmation SHALL allow unfinished work to continue

### Requirement: Grouped imports keep existing security and host claims

Grouped source/list/job requests SHALL follow existing JSON, origin, authentication, source-pinning, privacy, and metadata-only response rules. Each real child SHALL honour the existing cross-process per-host import claim. A competing CLI or automatic import SHALL not be bypassed. Original host history and OpenCode database sidecars SHALL remain unchanged.

#### Scenario: Another process already imports a host

- **WHEN** a queued OpenCode child reaches its start and another process holds OpenCode's import claim
- **THEN** that child SHALL be refused with the existing host-specific running reason
- **AND** the group SHALL stop later children without replacing the other process's claim

#### Scenario: A source changes while queued

- **WHEN** a child's source identity or pinned selection becomes invalid while an earlier child runs
- **THEN** the server SHALL refuse that child before its paid work
- **AND** it SHALL not silently refresh its selection

#### Scenario: A request comes from another website

- **WHEN** a disallowed origin submits a grouped source, listing, or import request
- **THEN** the server SHALL reject it before reading history or starting work

#### Scenario: Private conversation content

- **WHEN** selected history contains private-tagged text
- **THEN** every child SHALL retain the existing privacy filtering
- **AND** group reports and errors SHALL contain no prompt, model reply, or secret value

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
