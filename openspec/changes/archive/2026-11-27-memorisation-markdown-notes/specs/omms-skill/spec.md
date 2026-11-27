## MODIFIED Requirements

### Requirement: omms-remember writes a short snapshot from context

The omms-remember skill SHALL tell the agent to write a session snapshot (topic, done, doing, next) from what it already holds in context, plus cheap read-only state such as the git branch and head commit. It SHALL tell the agent to write `topic` as one short line, and `done`, `doing` and `next` as Markdown bullet lists with one fact per bullet. It SHALL forbid reading the full session history or transcript files. It SHALL tell the agent to size the snapshot to the note length and to keep it under the memorisation size cap.

#### Scenario: Agent follows the skill

- **WHEN** the user runs the omms-remember skill mid-session
- **THEN** the agent writes the snapshot without opening session history files

#### Scenario: Snapshot fields are bullet lists

- **WHEN** the agent saves a snapshot with three completed items
- **THEN** the `done` field holds three `-` bullet lines, not one paragraph

## ADDED Requirements

### Requirement: omms-remember reads the note length first

Before it writes a snapshot or a note, the omms-remember skill SHALL tell the agent to read the note length with the `memory` tool in mode `help`, or with `om-memory-system memory help` when no `memory` tool is listed. The skill SHALL give one sizing rule for each length:

- `short`: at most 3 bullets in each section.
- `medium`: at most 5 bullets in each section.
- `long`: at most 8 bullets in each section, and an optional Context section.
- `custom`: sized to the cap.

#### Scenario: Short length

- **WHEN** `help` reports note length `short` and the agent saves a snapshot
- **THEN** no section of the snapshot has more than 3 bullets

#### Scenario: Long length

- **WHEN** `help` reports note length `long` and the user asks to memorise a decision
- **THEN** the agent may add a Context section and up to 8 bullets in each section

#### Scenario: Help unavailable

- **WHEN** the `help` call fails
- **THEN** the agent writes a medium note and saves it

### Requirement: omms-remember writes composed notes as Markdown notes

When the agent writes a note for `content` from context, for example a decision the user asks it to memorise, the omms-remember skill SHALL tell the agent to write a Markdown note: a one-line plain title first, then `##` sections with bullet lists, with no paragraph longer than two sentences. The skill SHALL show one example note. When the user gives the exact text to save, the skill SHALL tell the agent to save that text unchanged, whatever the note length.

#### Scenario: Agent memorises a decision

- **WHEN** the user asks the agent to memorise a decision with its reasons and plan
- **THEN** the agent saves a `content` note whose first line is a plain title, followed by `##` sections such as Decision, Why and Plan with bullet items

#### Scenario: User dictates the text

- **WHEN** the user says "memorise exactly this: deploy freeze until Monday"
- **THEN** the agent saves "deploy freeze until Monday" unchanged
