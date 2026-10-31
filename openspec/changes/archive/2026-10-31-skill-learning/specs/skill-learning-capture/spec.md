# Spec Delta

## Purpose

Records full agent turns, tool outcomes and skill use from every host into a separate local store, only when the user turns it on, so OMMS can learn how the user's skills perform.

## ADDED Requirements

### Requirement: Turn recording is off until the user turns it on

OMMS SHALL record turns only when `skillLearning` is `true` in the global config. The default SHALL be `false`. A project config SHALL be able to set `skillLearning` to `false` for that project, and a project value of `true` SHALL be ignored.

#### Scenario: Default install

- **WHEN** a user finishes a turn on any host and has never changed `skillLearning`
- **THEN** OMMS SHALL NOT create or write `skills.db`

#### Scenario: A project turns it off

- **WHEN** `skillLearning` is `true` globally and the project config sets it to `false`
- **THEN** turns in that project SHALL NOT be recorded

#### Scenario: A project tries to turn it on

- **WHEN** `skillLearning` is `false` globally and the project config sets it to `true`
- **THEN** turns in that project SHALL NOT be recorded

### Requirement: A recorded turn keeps the full conversation

Each recorded turn SHALL hold the host, session id, project tag and name, model provider and id when known, the time, the full prompt text, every assistant reply in full, and every tool call in order with its name, input as the host reader bounds it, outcome, and error text. Tool output bodies SHALL NOT be stored.

#### Scenario: A turn with two tool calls

- **WHEN** recording is on and a turn has one prompt, two replies, a successful `Read` call and a failed `Bash` call
- **THEN** `skills.db` SHALL hold one turn with the prompt, both replies in full, and both tool calls in order
- **AND** the `Bash` call SHALL have outcome `error` and its error text

### Requirement: Every host records turns the same way

Pi, OpenCode (V1 and V2) and Claude Code SHALL record a turn when it ends, through shared code, with the same fields. Each host reader SHALL give each tool call an outcome of `ok`, `error` or `unknown`, and an error text of at most 2,000 characters when the host reports one.

#### Scenario: Same turn on each host

- **WHEN** recording is on and the same prompt runs a failing tool call on Pi, OpenCode and Claude Code
- **THEN** each host SHALL record one turn whose failing call has outcome `error`

#### Scenario: A host gives no outcome

- **WHEN** a host reports a tool call without a result
- **THEN** the call SHALL be recorded with outcome `unknown`

### Requirement: Recording does not depend on memory capture

A turn SHALL be recorded whether memory capture saves, skips or fails it, and whether memory capture is on. A failure to record SHALL be logged and SHALL NOT block or change memory capture, profile learning or manual `memory` operations.

#### Scenario: Capture skips a turn

- **WHEN** recording is on and memory capture returns `skip` for a turn
- **THEN** the turn SHALL still be recorded

#### Scenario: The store cannot be written

- **WHEN** `skills.db` cannot be opened during a turn
- **THEN** memory capture for that turn SHALL finish as it would without skill learning
- **AND** the log SHALL hold one record with code `skill-record-failed`

### Requirement: A turn is recorded once

Each turn SHALL be identified by its host, session id and the host's id for the user message. Live capture and history import SHALL build the same identity for the same turn. Recording the same turn again, for example after a capture retry or a later import, SHALL NOT add a second copy.

#### Scenario: Capture retries a turn

- **WHEN** memory capture tries the same turn three times
- **THEN** `skills.db` SHALL hold one copy of that turn

#### Scenario: A live turn is imported later

- **WHEN** a turn was recorded live and a history import later reads the same session
- **THEN** `skills.db` SHALL still hold one copy of that turn

### Requirement: Skill turns are a history import target

OpenCode, Pi and Claude Code history imports SHALL record skill turns when recording is on, unless the user passes `--skip-skills` or clears the **Skill turns** option. A dry run SHALL count the turns it would record and SHALL write nothing. When recording is off, imports SHALL record no skill turns, whatever the option says.

#### Scenario: An import with every target

- **WHEN** recording is on and the user runs `om-memory-system import-pi-history --scope all-projects`
- **THEN** the run SHALL save memories, record profile prompts and record skill turns, as before for the first two

#### Scenario: Skill turns skipped

- **WHEN** recording is on and the user passes `--skip-skills`
- **THEN** the run SHALL record no skill turns

### Requirement: Skill turns ignore the memory import ledger

When it records skill turns, an import SHALL read every session in its filters, including sessions and turns that the memory import ledger marks as handled or that live capture saved. It SHALL NOT change the memory ledger for a turn it reads only for skill turns.

#### Scenario: A session imported last month

- **WHEN** recording is on and an import reads a session whose turns the ledger marks `imported`
- **THEN** each of those turns SHALL be recorded in `skills.db`
- **AND** no memory SHALL be created again for them

### Requirement: A skill-turns-only import makes no model call

An import with only the skill turns target SHALL make no model call and SHALL need no capture or profile model. It SHALL record a progress entry and show progress with the phase **Skill turns**, like other imports.

#### Scenario: Only skill turns

- **WHEN** the user runs an import with `--skip-memories --skip-profile` and recording is on
- **THEN** the run SHALL finish with no model call
- **AND** the report SHALL show the number of turns recorded and already present

### Requirement: Automatic backfill records skill turns

When recording is on, automatic backfill SHALL record skill turns with the same cutoff and session selection it uses for memories.

#### Scenario: A host starts with recording on

- **WHEN** recording is on and a host's automatic backfill runs
- **THEN** the turns it reads SHALL be recorded in `skills.db`

### Requirement: Past turns can be recorded in one run

OMMS SHALL offer **Record past turns**: one skill-turns-only import across every set-up host and all projects, with no date limit. It SHALL be available from the web page and as `om-memory-system skills record-past --yes`, show progress, and be safe to run again.

#### Scenario: First run after turning recording on

- **WHEN** the user turns recording on and starts **Record past turns**
- **THEN** OMMS SHALL record turns from every set-up host's history with no model call

#### Scenario: Running it twice

- **WHEN** the user starts **Record past turns** a second time with no new history
- **THEN** the run SHALL add no turns and SHALL report them as already present

### Requirement: Redaction is a setting that is on by default

When `skillLearningRedact` is `true`, the default, OMMS SHALL remove `<private>` text and redact secrets with the capture trace's rules from the prompt, replies, tool inputs and error texts before storing a turn. A fully private prompt SHALL NOT be recorded. When it is `false`, text SHALL be stored as written. Only the global config SHALL set it.

#### Scenario: A private prompt

- **WHEN** redaction is on and the whole prompt is inside `<private>` tags
- **THEN** the turn SHALL NOT be recorded

#### Scenario: An API key in a tool input

- **WHEN** redaction is on and a tool input contains an API key
- **THEN** the stored input SHALL hold the redaction marker in place of the key

#### Scenario: Redaction off

- **WHEN** the user turns redaction off and a reply contains `<private>note</private>`
- **THEN** the stored reply SHALL contain `<private>note</private>` unchanged

### Requirement: Skill use is detected for every turn

For each recorded turn, OMMS SHALL record each skill the turn used and how: `tool` when the host's skill tool loaded it, `read` when a tool call read a `SKILL.md` inside a watched folder, and `command` when the prompt invoked it by name with the host's slash form.

#### Scenario: Claude Code loads a skill

- **WHEN** a Claude Code turn calls the `Skill` tool for `s-web-search`
- **THEN** the turn SHALL record skill use `s-web-search` with method `tool`

#### Scenario: Pi reads a skill file

- **WHEN** a Pi turn reads `~/.agents/skills/web/search/s-web-search/SKILL.md` and that folder is watched
- **THEN** the turn SHALL record skill use `s-web-search` with method `read`

### Requirement: skills.db is separate and stays in the storage path

Recorded turns SHALL be kept in `skills.db` in the global storage path and never inside a project folder. Project memories, `user-prompts.db`, the user profile and the memory chat SHALL NOT read from or write to `skills.db`.

#### Scenario: Profile learning runs

- **WHEN** profile learning analyses prompts while recording is on
- **THEN** it SHALL read only `user-prompts.db` and SHALL NOT read `skills.db`

### Requirement: Memories and the profile keep their current inputs

Turning recording on SHALL NOT change what memory capture sends to its model or what profile learning reads. Tool outcomes, error texts and skill use SHALL go only to `skills.db`.

#### Scenario: Same turn with recording on and off

- **WHEN** the same turn is captured once with recording off and once with recording on
- **THEN** the memory capture request SHALL be the same both times
- **AND** the profile SHALL receive the same prompt both times

### Requirement: The log never holds turn text

Log records about recording SHALL hold only the host, codes, counts and sizes. They SHALL NOT hold prompt text, reply text, tool inputs or error texts.

#### Scenario: A turn is recorded

- **WHEN** a turn is recorded
- **THEN** the log record SHALL hold the host, tool call count and stored size, and no turn text

### Requirement: The user can delete recorded turns

The user SHALL be able to delete every recorded turn, with its tool calls and skill uses, from the Settings page or the terminal. Proposals and saved skill versions SHALL stay. Turning recording off SHALL NOT delete recorded turns.

#### Scenario: Delete from the terminal

- **WHEN** the user runs `om-memory-system skills delete-turns --yes`
- **THEN** `skills.db` SHALL hold no turns, tool calls or skill uses
- **AND** pending proposals SHALL still be listed
