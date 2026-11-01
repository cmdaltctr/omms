# Spec Delta

## MODIFIED Requirements

### Requirement: Agents and the terminal reach the same operations

Pi, OpenCode and Claude Code SHALL offer one `skills` tool with modes `list`, `ideas`, `draft`, `evidence`, `propose`, `proposals`, `show`, `apply`, `reject`, `undo` and `help`. The `om-memory-system skills` command SHALL offer the same modes, `delete-turns` and `record-past`. Results SHALL match the web page for the same store.

#### Scenario: An agent applies a proposal

- **WHEN** an agent calls `skills` with mode `apply` and a pending proposal id
- **THEN** OMMS SHALL apply it with the same checks as the page
- **AND** the proposal SHALL record that an agent applied it

#### Scenario: Recording is off

- **WHEN** `skillLearning` is `false` and an agent calls `skills` with mode `list`
- **THEN** the tool SHALL say that recording is off and where to turn it on

#### Scenario: The proposals mode returns summaries

- **WHEN** an agent calls `skills` with mode `proposals`, or the user runs `om-memory-system skills proposals --json`
- **THEN** each proposal in the result data SHALL have the summary fields of a proposal list and SHALL NOT have `content` or `diff`
- **AND** mode `show` with the proposal id SHALL return the full proposal with `content` and `diff`

## ADDED Requirements

### Requirement: Proposal lists return summaries

Every list of proposals that OMMS returns SHALL hold, for each proposal, its id, kind, skill name, skill path, state, who applied it, who drafted it, summary, evidence turn ids, creation and update times, added and removed line counts, `hasDiff` and `canUndo`. A list SHALL NOT hold the proposed content or the diff. `GET /api/skills/proposals/:id` SHALL return the full proposal with its content, diff and evidence turns.

#### Scenario: The proposals route

- **WHEN** a client calls `GET /api/skills/proposals`
- **THEN** no proposal in the reply SHALL have a `content` or a `diff` field
- **AND** each proposal SHALL have `added`, `removed`, `hasDiff` and `canUndo`

#### Scenario: The proposals of one skill

- **WHEN** a client calls `GET /api/skills/skill` for a skill with proposals
- **THEN** its proposals SHALL have the same summary fields as `GET /api/skills/proposals`

#### Scenario: The detail route

- **WHEN** a client calls `GET /api/skills/proposals/:id` for a stored proposal
- **THEN** the reply SHALL hold the proposal with its `content` and `diff`, and its evidence turns

### Requirement: Line counts in a list match the diff

The `added` and `removed` counts of a listed proposal SHALL be the lines that start with `+` and `-` in its diff, with hunk headers skipped. A proposal with no diff, such as a new skill, SHALL count every line of its content as added and none as removed.

#### Scenario: An improvement

- **WHEN** a pending improvement has a diff with 14 added lines and 2 removed lines
- **THEN** the list SHALL show `added` 14 and `removed` 2 for it

#### Scenario: A new skill

- **WHEN** a new-skill proposal has no diff and 40 lines of content
- **THEN** the list SHALL show `added` 40, `removed` 0 and `hasDiff` false for it

### Requirement: canUndo in a list matches undo

The `canUndo` value of each listed proposal SHALL be true only when **Undo** would accept that proposal now, with the same checks as undo. It SHALL be false for any proposal that is not applied.

#### Scenario: A later change rewrote the file

- **WHEN** two proposals of one skill were applied and the second rewrote the file
- **THEN** the list SHALL show `canUndo` false for the first and true for the second
