# web-skills Specification

## Purpose

Gives skill learning its own page in the web UI and its own settings card, with clear warnings about what the user chooses to store on their computer.

## Requirements

### Requirement: The left bar has a Skills entry

The sidebar main list SHALL show a **Skills** entry after **User profile**, with an icon and an accessible label in every supported language. Selecting it SHALL open `/skills`. Opening `/skills` directly or reloading it SHALL show the same page.

#### Scenario: Open from the sidebar

- **WHEN** the user selects **Skills** in the sidebar
- **THEN** the browser SHALL show `/skills` and the Skills page

### Requirement: The Skills page lists ranked skills

The Skills page SHALL list skills from the watched folders and recorded turns, with name, folder, use count, failed turns, attention, last use, mode and a **Suggested** badge when it applies. The user SHALL be able to filter the list by name, choose the sort order **Most used** or **Needs attention** (remembered in the browser), and open one skill.

#### Scenario: A suggested skill

- **WHEN** a skill meets the **Suggested** rule
- **THEN** its row SHALL show the **Suggested** badge

### Requirement: A skill view offers drafting and mode

The view for one skill SHALL show its path, its counts, its recent turns, a **Draft improvement** button, and a **Manual** or **Automatic** choice. Choosing **Automatic** SHALL first show a warning that OMMS will change the file without asking, and SHALL need confirmation.

#### Scenario: Turn on automatic mode

- **WHEN** the user chooses **Automatic** for a skill
- **THEN** the page SHALL show the warning and SHALL change the mode only after the user confirms

### Requirement: Proposals show a diff with actions

The page SHALL list proposals with their state: pending, applied, applied automatically, rejected, stale or undone. A pending proposal SHALL show a line diff, the summary and its evidence turns, with **Apply** and **Reject**. An applied proposal SHALL offer **Undo**. The page SHALL load the content, the diff and the evidence turns of a proposal when its card opens, not with the list.

#### Scenario: Apply from the page

- **WHEN** the user selects **Apply** on a pending proposal
- **THEN** the proposal SHALL show `applied` and offer **Undo**

#### Scenario: Show more loads the full proposal

- **WHEN** the user selects **Show more** on a compact proposal card
- **THEN** the page SHALL request that proposal by its id
- **AND** the card SHALL show the full line diff, or the content of a new skill, and the evidence turns

#### Scenario: The compact card uses the list counts

- **WHEN** the Skills page shows a compact proposal card
- **THEN** the line chip SHALL show the `added` and `removed` counts from the list
- **AND** the page SHALL NOT have requested the content or the diff of that proposal

#### Scenario: The full proposal cannot load

- **WHEN** the user selects **Show more** and the request for the proposal fails
- **THEN** the card SHALL say that the proposal could not be loaded and SHALL keep **Apply** and **Reject** available

### Requirement: The page manages watched folders

The Skills page SHALL show the watched folders, the number of skills found in each, and controls to add a folder by path and to remove one. Changes SHALL save `skillFolders` through the safe Settings save flow.

#### Scenario: Add a folder

- **WHEN** the user adds an existing folder that holds two skills
- **THEN** the folder SHALL be listed with **2 skills** and its skills SHALL join the list

### Requirement: The Settings page has a Skill learning card

The Settings page SHALL show a **Skill learning** card, listed in the Settings sidebar tree. It SHALL hold a **Record agent turns** switch for `skillLearning`, a **Remove private text and secrets** switch for `skillLearningRedact`, the turn count and file size of `skills.db`, and **Delete recorded turns**.

#### Scenario: Open the card

- **WHEN** the user opens the Settings page
- **THEN** the **Skill learning** card SHALL show both switches and the store size

### Requirement: Turning on recording shows what is stored

When **Record agent turns** is on, the card SHALL show a warning callout. It SHALL say that OMMS stores full prompts, replies and tool calls in `skills.db` on this computer, that drafting sends recorded turns to the external API, and that the file holds whatever the turns hold. It SHALL also say that the memory chat sends skill counts and short change summaries to the external API, and no turn text.

#### Scenario: Recording on

- **WHEN** the user turns on **Record agent turns**
- **THEN** the warning callout SHALL appear in the card

#### Scenario: Chat named in the warning

- **WHEN** **Record agent turns** is on
- **THEN** the warning callout SHALL say that the memory chat sends skill counts and short change summaries to the external API

### Requirement: Turning off redaction shows a stronger warning

When **Remove private text and secrets** is off, the card SHALL show a danger callout. It SHALL say that `<private>` text, API keys and passwords will be stored as written and sent to the external API when drafting. Turning the switch off SHALL need confirmation.

#### Scenario: Redaction off

- **WHEN** the user turns off **Remove private text and secrets** and confirms
- **THEN** the danger callout SHALL appear and the setting SHALL save as `false`

### Requirement: Deleting turns asks first

**Delete recorded turns** SHALL show a confirmation with the number of turns to delete. Confirming SHALL delete them and update the count to 0.

#### Scenario: Confirm a delete

- **WHEN** the store holds 340 turns and the user confirms **Delete recorded turns**
- **THEN** the card SHALL show 0 turns

### Requirement: The import form has a Skill turns option

The Import chat history section on the Memory page SHALL show a **Skill turns** checkbox beside the project memories and user profile options. It SHALL be ticked by default when recording is on. When recording is off, it SHALL be cleared and disabled, with a note that links to the **Skill learning** card. Preview SHALL show the number of turns it would record.

#### Scenario: Recording off

- **WHEN** recording is off and the user opens the import form
- **THEN** **Skill turns** SHALL be disabled with a link to the settings card

#### Scenario: Only skill turns chosen

- **WHEN** the user ticks only **Skill turns** and runs the import
- **THEN** the progress bar SHALL show the phase **Skill turns** and no model SHALL be required

### Requirement: Turning recording on offers past turns

After the user turns **Record agent turns** on, the settings card SHALL offer **Record past turns**. The Skills page SHALL offer it too when no turns are recorded. It SHALL show progress and the count of turns recorded when it ends.

#### Scenario: Recording turned on

- **WHEN** the user turns on **Record agent turns**
- **THEN** the card SHALL show **Record past turns**
- **AND** starting it SHALL show progress until it ends

### Requirement: The page explains when recording is off

When `skillLearning` is `false`, the Skills page SHALL show an info callout that says nothing is recorded yet and links to the **Skill learning** card. Watched folders and existing proposals SHALL still be shown.

#### Scenario: Fresh install

- **WHEN** the user opens `/skills` with recording off
- **THEN** the page SHALL show the info callout with a link to the settings card

### Requirement: A failed tool call count opens its details

On a recorded turn row of the Skills page, the label that counts failed tool calls SHALL be a button. Selecting it SHALL open a dialog that lists every failed call of that turn in order, with its position in the turn, tool name, error text and input. The page SHALL request the failed calls of that turn only when the user opens the dialog, and SHALL NOT include them in the turn list.

#### Scenario: Open the failed calls of a turn

- **WHEN** the user selects "2 failed tool calls" on a turn row
- **THEN** the page SHALL request the failed calls of that turn
- **AND** the dialog SHALL list both calls with tool name, error text and input

#### Scenario: A turn with no failures has no button

- **WHEN** a turn row has no failed tool call
- **THEN** the row SHALL NOT show the failed tool call label or a button for it

### Requirement: A failed call with no error text says so

When a failed call has no stored error text, the dialog SHALL show "No error text recorded" in place of the error. It SHALL still show the tool name and input.

#### Scenario: No error text

- **WHEN** a failed call has an `error` outcome and no error text
- **THEN** the dialog SHALL show "No error text recorded" for that call

### Requirement: The dialog keeps long input short and copyable

The dialog SHALL show at most the first 400 characters of a call's input, with a **Show full input** control for the rest. Each call SHALL have a **Copy** button that copies the tool name, error text and input. The server SHALL send at most 20000 characters of input per call and SHALL say when it cut the input.

#### Scenario: Long input

- **WHEN** a failed call has input longer than 400 characters
- **THEN** the dialog SHALL show the first 400 characters and a **Show full input** control
- **AND** selecting the control SHALL show the full received input

#### Scenario: The server cuts very long input

- **WHEN** a failed call has input longer than 20000 characters
- **THEN** the reply SHALL hold the first 20000 characters and mark the input as cut
- **AND** the dialog SHALL say that the input was cut

### Requirement: The dialog shows stored text only

The failed-call dialog SHALL show only text that skill learning already stored, after its `<private>` removal and secret redaction. The routes SHALL NOT write the text to the log, and SHALL NOT return tool output bodies, which are not stored.

#### Scenario: Redacted text stays redacted

- **WHEN** a turn was recorded with redaction on and its failed call input held a secret
- **THEN** the dialog SHALL show the redacted input as stored

### Requirement: The dialog reports a failed load

When the request for failed calls fails, the dialog SHALL say that the failed calls could not be loaded and SHALL offer **Close**. The turn list SHALL stay usable.

#### Scenario: The request fails

- **WHEN** the user opens the dialog and the request fails
- **THEN** the dialog SHALL show the message that the failed calls could not be loaded

### Requirement: The skill view groups repeated failures

The view for one skill SHALL show a **Failures** section below its recent turns. The section SHALL group the skill's failed calls by tool name and the first line of the error text, cut to 200 characters. Calls with no error text SHALL form one group per tool name. A trailing carriage return SHALL NOT be part of the first line. The section SHALL show at most 50 groups, the ones with the most calls first.

#### Scenario: One error repeats across turns

- **WHEN** the same tool fails with the same first error line in 5 turns that used the skill
- **THEN** the Failures section SHALL show one group with 5 calls over 5 turns

#### Scenario: Different errors form separate groups

- **WHEN** one tool fails with two different first error lines
- **THEN** the Failures section SHALL show two groups for that tool

#### Scenario: Many groups

- **WHEN** a skill has 60 groups
- **THEN** the Failures section SHALL show the 50 groups with the most calls

### Requirement: A failure group shows its counts and sample

Each group SHALL show the number of calls, the number of turns, the last time seen and a sample error. The groups SHALL page with the shared paged-list toolbar and footer, at the default page size of 5. The default order SHALL be by number of calls, most first, and the reader SHALL be able to change it with the shared sort control.

#### Scenario: Group order

- **WHEN** one group has 9 calls and another has 3
- **THEN** the group with 9 calls SHALL appear first under the default sort

#### Scenario: Paging the groups

- **WHEN** the Failures section holds 8 groups
- **THEN** the section SHALL show the first 5 with the shared footer
- **AND** the footer SHALL offer the second page

### Requirement: Only calls that count against the skill are grouped

The Failures section SHALL group only the failed calls that count against the skill by the ranking rule: calls after the skill was used, or every call of a turn the skill started by slash command.

#### Scenario: A failure before the skill was used

- **WHEN** a tool call fails before the turn loaded the skill
- **THEN** the Failures section SHALL NOT count that call

#### Scenario: No failures

- **WHEN** the skill has no failed call that counts against it
- **THEN** the Failures section SHALL say that no failed tool calls are recorded for this skill

### Requirement: A failure group opens its latest calls

Selecting a group in the Failures section SHALL open the failed-call dialog with the latest 5 calls of that group, newest first, each with the time and project of its turn. The groups reply SHALL carry those calls, so opening a group needs no second request.

#### Scenario: Open a group

- **WHEN** the user selects a group with 12 calls
- **THEN** the dialog SHALL list the latest 5 calls of the group, newest first
- **AND** the dialog SHALL say that 12 calls are in the group

### Requirement: The Failures section offers an explanation

The Failures section SHALL show an **Explain failures** button at its top. Selecting it SHALL send the skill's failure groups and its `SKILL.md` to the external API model and show the reply in the section.

#### Scenario: Explain a skill's failures

- **WHEN** the user selects **Explain failures** on a skill with three failure groups
- **THEN** the section SHALL show the explanation of those groups

### Requirement: The explanation has a summary and labelled causes

The reply SHALL have a plain summary and a list of causes. Each cause SHALL have a label (skill fix, host or harness bug, environment problem, or unknown), an explanation and suggested actions. The panel SHALL say that the suggestions are leads from error text only, because the model cannot see the host's code.

#### Scenario: Labelled causes

- **WHEN** the model returns a cause labelled host or harness bug
- **THEN** the panel SHALL show the label, the explanation and the suggested actions
- **AND** the panel SHALL say the suggestions are leads from error text only

### Requirement: The explanation is not saved

OMMS SHALL show the reply on the page only. It SHALL NOT store the reply or turn it into a proposal.

#### Scenario: The reply is not kept

- **WHEN** the user leaves the skill view and returns
- **THEN** the section SHALL NOT show the earlier explanation

### Requirement: The explanation sends grouped data only

The request to the model SHALL hold the skill name, its `SKILL.md`, and at most 10 failure groups, most calls first. Each group SHALL give the tool name, the first error line, the call count, the turn count, the last time seen and one input excerpt of at most 500 characters. The request SHALL NOT hold prompts, replies or tool input beyond those excerpts.

#### Scenario: More than 10 groups

- **WHEN** a skill has 14 failure groups
- **THEN** the request SHALL hold the 10 groups with the most calls

### Requirement: The button is disabled when it cannot work

The **Explain failures** button SHALL be disabled, with a note beside it, when skill learning is off, or when the skill has no failure group. It SHALL stay disabled while the groups or the settings load. The server SHALL refuse the explain request, and SHALL send nothing to a model, while skill learning is off. When the external API is not set up, selecting the button SHALL show a message with a link to the External API card and SHALL send nothing.

#### Scenario: Skill learning is off

- **WHEN** skill learning is off
- **THEN** the button SHALL be disabled
- **AND** the note SHALL say that skill learning must be on

#### Scenario: No external API

- **WHEN** the user selects the button and the external API is not set up
- **THEN** the page SHALL link to the External API card and SHALL NOT send a request to a model

### Requirement: The first use shows a warning

Before the first explanation, the page SHALL show a confirmation that says what is sent (failure groups, error text, short input excerpts, the `SKILL.md`), where it goes (the external API model), and that redaction applies as stored. The confirmation SHALL show a stronger warning when redaction is off. The page SHALL send nothing until the user confirms. The page SHALL remember the confirmation in the browser, and SHALL ask again when the browser cannot keep it.

#### Scenario: First use

- **WHEN** the user selects **Explain failures** for the first time in this browser
- **THEN** the page SHALL show the confirmation and SHALL send nothing until the user confirms

#### Scenario: Redaction is off

- **WHEN** redaction is off and the confirmation opens
- **THEN** the confirmation SHALL warn that text may hold secrets that were not removed

#### Scenario: Later uses

- **WHEN** the user has confirmed before in this browser
- **THEN** selecting the button SHALL send the request without the confirmation

### Requirement: An info button shows the warning again

An "i" button beside **Explain failures** SHALL open a popover with the same warning text. It SHALL close on Escape or a click outside. While the redaction setting is unknown, the warning SHALL be the stronger one.

#### Scenario: Open the info popover

- **WHEN** the user selects the "i" button
- **THEN** a popover SHALL show what is sent, where it goes and the redaction note

### Requirement: A failed explanation changes nothing

When the model call fails, the section SHALL show a message and keep the failure groups usable. OMMS SHALL log a fixed reason code and SHALL NOT log turn text or the reply.

#### Scenario: The model times out

- **WHEN** the explanation request times out
- **THEN** the section SHALL show an error message and the groups
- **AND** the log SHALL hold the code `timeout` and no turn text

### Requirement: The skill view offers a table of contents

The skill view SHALL show a small table-of-contents control pinned to the top end of the view. The control SHALL expand into a list that starts with **All skills**, which leaves the skill view and returns to the list, followed by the view's sections in page order, and minimise back to its icon. Selecting a section SHALL scroll the page to that section at once and outline it for a moment. The expanded or minimised choice SHALL persist per browser.

#### Scenario: Return to the list

- **WHEN** the reader selects **All skills** in the table of contents
- **THEN** the view SHALL return to the skills list

#### Scenario: Jump to a section

- **WHEN** the reader selects **Proposals** in the table of contents
- **THEN** the view SHALL scroll to the Proposals section and outline it for a moment

#### Scenario: Minimise

- **WHEN** the reader selects the control's icon while it is expanded
- **THEN** the control SHALL collapse to its icon
- **AND** the collapsed choice SHALL persist after a reload

### Requirement: The Skills page offers a table of contents

The Skills page (the list view) SHALL show the same floating table-of-contents control as the skill view, without a back entry: a small control fixed at the top end of the screen, which expands into the page's sections in page order and minimises back to its icon. Selecting a section SHALL scroll to it at once and outline it for a moment. The choice SHALL persist per browser, under its own key. The control SHALL NOT show while one skill's view is open.

#### Scenario: Jump from the list

- **WHEN** the reader selects **Pending proposals** in the table of contents
- **THEN** the page SHALL scroll to the Pending proposals section and outline it for a moment

#### Scenario: One skill's view keeps its own contents

- **WHEN** the reader opens one skill
- **THEN** the page's table of contents SHALL be replaced by the skill view's own contents
