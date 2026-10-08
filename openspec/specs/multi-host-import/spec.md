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
