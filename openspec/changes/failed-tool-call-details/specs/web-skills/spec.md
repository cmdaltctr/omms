## ADDED Requirements

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

The view for one skill SHALL show a **Failures** section above its recent turns. The section SHALL group the skill's failed calls by tool name and the first line of the error text, cut to 200 characters. Calls with no error text SHALL form one group per tool name.

#### Scenario: One error repeats across turns

- **WHEN** the same tool fails with the same first error line in 5 turns that used the skill
- **THEN** the Failures section SHALL show one group with 5 calls over 5 turns

#### Scenario: Different errors form separate groups

- **WHEN** one tool fails with two different first error lines
- **THEN** the Failures section SHALL show two groups for that tool

### Requirement: A failure group shows its counts and sample

Each group SHALL show the number of calls, the number of turns, the last time seen and a sample error. Groups SHALL be ordered by number of calls, most first.

#### Scenario: Group order

- **WHEN** one group has 9 calls and another has 3
- **THEN** the group with 9 calls SHALL appear first

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
