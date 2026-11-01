# skill-learning-proposals Specification

## Purpose

Turns recorded turns into ranked skills and reviewed proposals that improve existing skills or add new ones, applied by hand or automatically, with undo, from the web page, the terminal or an agent tool.

## Requirements

### Requirement: The user chooses the skill folders OMMS watches

`skillFolders` in the global config SHALL list the folders OMMS reads skills from and may write skills to. When it is unset, OMMS SHALL use `~/.agents/skills` and the `skills` folder in the Claude Code folder in use, each only when it exists. Each entry SHALL be an absolute path to an existing folder, or `~/` followed by a path.

#### Scenario: Unset with both folders present

- **WHEN** `skillFolders` is unset and both `~/.agents/skills` and `~/.claude/skills` exist
- **THEN** OMMS SHALL watch both folders

#### Scenario: A folder that does not exist

- **WHEN** the user adds a folder that does not exist
- **THEN** the save SHALL fail with a message that names the folder

### Requirement: Skills are found in nested folders

OMMS SHALL find every `SKILL.md` up to four folder levels below each watched folder. A skill's name SHALL be the `name` in its front matter, or its folder name when the front matter has none. When two skills share a name, both SHALL be listed with their paths.

#### Scenario: A category folder

- **WHEN** a watched folder holds `web/search/s-web-search/SKILL.md`
- **THEN** OMMS SHALL list skill `s-web-search` at that path

### Requirement: Skills are ranked by use and attention in the last 30 days

For each skill, OMMS SHALL count from recorded turns in the last 30 days: U, the turns that used it; F, the turns that used it and had a failed tool call after the skill was used in that turn; and the time of last use. The list SHALL sort by use count, highest first, then name, or on request by attention, highest first, then use count, then name. A draft that proposes no change SHALL count as a proposal for the Suggested rule.

#### Scenario: Heavy use against rough use

- **WHEN** skill A has 40 uses and 0 failed turns, and skill B has 6 uses and 4 failed turns
- **THEN** the default list SHALL put A first
- **AND** the list sorted by attention SHALL put B first

#### Scenario: One use and one failure

- **WHEN** a skill has 1 use and 1 failed turn
- **THEN** its attention SHALL be 0.67
- **AND** it SHALL NOT be marked **Suggested**, because U is below 5

#### Scenario: A busy skill with failures

- **WHEN** `s-web-search` was used in 12 turns in the last 30 days and 4 of them had a failed tool call
- **THEN** the list SHALL show 12 uses and 4 failed turns
- **AND** the skill SHALL be marked **Suggested**

#### Scenario: A draft proposes no change

- **WHEN** `s-web-search` is marked **Suggested** and a draft for it returns **No change proposed**
- **THEN** the skill SHALL NOT be marked **Suggested**
- **AND** the skill SHALL be marked **Suggested** again after a new turn that uses it has a failed tool call

#### Scenario: A skill outside the watched folders

- **WHEN** a turn used a skill that has no `SKILL.md` in a watched folder
- **THEN** the list SHALL show it with the note **Not in a watched folder** and SHALL NOT offer a draft

### Requirement: Failures count only after the skill was used

OMMS SHALL record, for each skill use, the position of the tool call that loaded it, and -1 for a slash command. A use with no recorded position SHALL count as -1. When a turn used a skill more than once, the earliest use SHALL decide which failed tool calls count.

#### Scenario: A failure before the skill loaded

- **WHEN** a turn has a failed tool call at position 0 and the skill is loaded by the tool call at position 1
- **THEN** that turn SHALL NOT count as a failed turn for the skill

#### Scenario: A slash-command skill

- **WHEN** a turn invokes the skill by its slash form and any tool call in that turn fails
- **THEN** that turn SHALL count as a failed turn for the skill

### Requirement: Attention score and the Suggested rule

OMMS SHALL give each skill an attention score of (F + 1) / (U + 2), rounded to two decimals. A skill SHALL be marked **Suggested** when it is in a watched folder, U is 5 or more, attention is 0.3 or more, and a failed turn happened since the later of its last proposal and last review.

#### Scenario: Attention below the minimum

- **WHEN** a skill has 40 uses and 1 failed turn
- **THEN** its attention SHALL be 0.05
- **AND** it SHALL NOT be marked **Suggested**

### Requirement: An improvement draft is a reviewed diff

Drafting an improvement for a skill SHALL send its current `SKILL.md` and at most 20 of the most recent recorded turns that used it to the external API model. OMMS SHALL save the reply as a pending proposal with the revised file, a summary, the turns it used as evidence, a diff against the current file, and a hash of the file it started from.

#### Scenario: A draft with changes

- **WHEN** the user drafts an improvement for `s-web-search` and the model returns a revised file
- **THEN** a pending proposal SHALL show the diff, the summary and links to the evidence turns

#### Scenario: No change proposed

- **WHEN** the model returns a file identical to the current one
- **THEN** OMMS SHALL save no proposal and SHALL say **No change proposed**

#### Scenario: External API not set up

- **WHEN** the external API is not fully configured
- **THEN** drafting SHALL be unavailable with a link to the External API card

### Requirement: New skill ideas come from recorded turns

**Find new skill ideas** SHALL send a compact list of up to 200 recent recorded turns and the names and descriptions of watched skills to the external API model. It SHALL return at most three ideas, each with a name, a description, a reason and evidence turns. An idea whose name matches a watched skill SHALL be dropped.

#### Scenario: An idea is drafted

- **WHEN** the user chooses an idea and a watched folder and selects **Draft skill**
- **THEN** a pending proposal of kind `new` SHALL hold a full `SKILL.md` with `name` and `description` front matter

### Requirement: Each skill is in manual or automatic mode

Each skill SHALL have a mode, `manual` by default. In manual mode a proposal SHALL be applied only when the user, or an agent through the `skills` tool, applies it. In automatic mode OMMS SHALL draft an improvement once the skill has 10 new uses since its last review and at least 24 hours have passed, and SHALL apply it without asking.

#### Scenario: Manual mode

- **WHEN** a skill in manual mode has a pending proposal
- **THEN** its file SHALL stay unchanged until the proposal is applied

#### Scenario: Automatic mode

- **WHEN** a skill in automatic mode reaches 10 new uses 30 hours after its last review
- **THEN** OMMS SHALL draft and apply an improvement
- **AND** the proposal SHALL show **Applied automatically** with **Undo**

### Requirement: A failed draft waits before automatic review tries again

When a draft fails, OMMS SHALL log a fixed reason code (`timeout`, `http-<status>`, `invalid-reply`, `not-configured` or `error`) with no turn text. Automatic review SHALL then start no draft for 10 minutes. This wait SHALL NOT pause profile learning, and a profile failure SHALL NOT pause skill drafting. Only one automatic review SHALL run at a time across processes.

#### Scenario: The external API times out

- **WHEN** an automatic draft times out
- **THEN** the log SHALL hold one record with reason `timeout`
- **AND** no automatic draft SHALL start for 10 minutes while profile learning keeps running

### Requirement: A proposal applies only to the file it was drafted from

Before writing, OMMS SHALL compare the file on disk with the hash saved in the proposal. When they differ, the proposal SHALL become `stale` and the file SHALL NOT change. A new-skill proposal SHALL NOT overwrite an existing file. This SHALL apply in both modes.

#### Scenario: The user edited the file after the draft

- **WHEN** the user edits `SKILL.md` by hand and then applies an older proposal for it
- **THEN** the file SHALL keep the user's edit
- **AND** the proposal SHALL show **Stale: the file changed since this draft**

### Requirement: OMMS writes only SKILL.md inside a watched folder

OMMS SHALL write a file only when it is named `SKILL.md` and its resolved real path, after following links, is inside the resolved real path of a watched folder. A new skill's name SHALL be lower-case letters, digits and hyphens. The write SHALL replace the file in one step so a reader never sees half a file.

#### Scenario: A link that leaves the folder

- **WHEN** a skill folder is a link to a folder outside every watched folder
- **THEN** applying a proposal for it SHALL fail and the file SHALL NOT change

### Requirement: An applied proposal can be undone

Each apply SHALL first save the previous file content in `skills.db`. **Undo** SHALL restore that content, or delete the file for a new skill, only when the file still matches what OMMS wrote. When it does not match, undo SHALL refuse and SHALL show the saved content.

#### Scenario: Undo after an automatic apply

- **WHEN** the user selects **Undo** on an automatic proposal and the file is unchanged since
- **THEN** the file SHALL hold its previous content
- **AND** the proposal SHALL show `undone`

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

### Requirement: An agent can fix a skill without the external API

The `skills` tool SHALL let the coding agent read a skill's evidence (`evidence`) and propose a revised `SKILL.md` itself (`propose`), with no model call by OMMS. `propose` SHALL compute the base hash and diff from the file on disk, record that the agent drafted it, and refuse content over 100 KB. The tool description SHALL say that the turn text enters the agent's own session.

#### Scenario: Evidence for a skill

- **WHEN** an agent calls `skills` with mode `evidence` and a watched skill that has recorded uses
- **THEN** the reply SHALL hold the path, the current `SKILL.md`, the uses, failed turns and attention, and the newest recorded turns with their tool calls, outcomes and errors
- **AND** turns with a failed call after the skill loaded SHALL come first, cut to 4,000 characters each and 60,000 in total
- **AND** OMMS SHALL make no external API call

#### Scenario: The agent proposes a revised file

- **WHEN** an agent calls `skills` with mode `propose`, the skill, a changed `content` and a summary
- **THEN** OMMS SHALL save a pending proposal with a line diff against the file on disk
- **AND** the reply SHALL show the diff, and the file SHALL NOT change

#### Scenario: Identical content gives no change

- **WHEN** the proposed content equals the current file
- **THEN** OMMS SHALL save no proposal, SHALL reply `no-change`, and SHALL count it as a review

#### Scenario: Apply still waits for the user's request

- **WHEN** an agent has proposed a revised file
- **THEN** the file SHALL change only after a separate `apply` call, which the tool description reserves for when the user asks

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
