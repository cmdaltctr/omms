## MODIFIED Requirements

### Requirement: Session snapshot fields

`memorise` SHALL accept a session snapshot made of optional `topic`, `done`, `doing` and `next` text fields instead of free content. OMMS SHALL store the snapshot as one Markdown note: the topic as the first line, then a `## Done`, `## Doing` and `## Next` heading for each field that has text, with the field text on the lines below its heading. OMMS SHALL leave out empty fields and SHALL tag the record with the host session ID when the host provides one.

#### Scenario: Snapshot from an agent

- **WHEN** the agent calls `memorise` with topic "memorisation proposal", done "proposal written", doing "validating specs" and next "wait for approval"
- **THEN** OMMS stores one record whose first line is "memorisation proposal", followed by `## Done`, `## Doing` and `## Next` sections, and returns its ID

#### Scenario: List in a field

- **WHEN** the agent calls `memorise` with done "- tests written\n- docs updated"
- **THEN** the stored record has `## Done` on its own line and both bullet lines below it

#### Scenario: Snapshot without a topic

- **WHEN** the agent calls `memorise` with only next "run ci:local"
- **THEN** the stored record starts with `## Next` and has no empty sections

#### Scenario: Records saved before the change

- **WHEN** the store holds a snapshot saved as `Topic: x` and `Done: y` lines
- **THEN** OMMS leaves the record text unchanged and recall returns it as stored

#### Scenario: Neither content nor snapshot

- **WHEN** `memorise` is called with no content and no snapshot field
- **THEN** OMMS refuses with an error that names the missing input

#### Scenario: Snapshot fields without a mode

- **WHEN** the agent calls `memory` with `topic`, `done`, `doing` or `next` and no `mode`
- **THEN** the call returns `success: false` with the error "mode is required: use memorise for snapshot fields" and nothing is stored

## ADDED Requirements

### Requirement: Note length presets

OMMS SHALL name three size cap values as the note length presets Short, Medium and Long. Each preset value SHALL be in characters. Its value in tokens SHALL be the character value divided by 4 and rounded up. The note length SHALL be the preset whose value, in the saved `memorisationSizeUnit`, equals the saved `memorisationMaxSize`. Any other valid cap SHALL be the length `custom`.

#### Scenario: Default cap

- **WHEN** the config sets no size cap and no preset values
- **THEN** the note length is `medium` with a cap of 2,000 characters

#### Scenario: Token preset

- **WHEN** the presets are the defaults and the cap is 1,250 tokens
- **THEN** the note length is `long`

#### Scenario: Custom value

- **WHEN** the presets are the defaults and the cap is 3,000 characters
- **THEN** the note length is `custom` with a cap of 3,000 characters

### Requirement: Preset value settings

Global settings `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` SHALL set the preset values in characters, with defaults of 800, 2,000 and 5,000. A project config SHALL NOT set these keys.

#### Scenario: Edited preset

- **WHEN** the user sets `memorisationShortSize` to 1,000 and the cap is 1,000 characters
- **THEN** the note length is `short`

#### Scenario: Edited preset in tokens

- **WHEN** `memorisationShortSize` is 1,000 and the cap is 250 tokens
- **THEN** the note length is `short`

#### Scenario: Project config

- **WHEN** a project config sets `memorisationLongSize`
- **THEN** OMMS ignores it and uses the global value

### Requirement: Preset value rules

Each preset value SHALL be a whole number from 100 to 20,000. Short SHALL be less than Medium, and Medium SHALL be less than Long. Each preset SHALL also be at least one token above the preset below it, so the two keep different token values. OMMS SHALL refuse an edit that breaks a rule, name the rule, and keep the previous values. When the config file breaks a rule, OMMS SHALL name the broken key and its rule in the config problem.

#### Scenario: Presets out of order

- **WHEN** the user sets `memorisationShortSize` to 3,000 while `memorisationMediumSize` is 2,000
- **THEN** OMMS refuses the edit, says Short must be less than Medium, and keeps 800

#### Scenario: Presets with one token value

- **WHEN** the user sets `memorisationShortSize` to 1,997 while `memorisationMediumSize` is 2,000
- **THEN** OMMS refuses the edit and says Short and Medium must differ by at least one token, because both are about 500 tokens

#### Scenario: Broken preset in the config file

- **WHEN** the global config file sets only `memorisationMediumSize`, to 700, below the default Short of 800
- **THEN** OMMS names `memorisationMediumSize` and its rule in the config problem, and uses the default value for it

### Requirement: Help reports the note length

The `memory` tool's `help` mode and the `om-memory-system memory help` command SHALL return the current note length: the preset name, the cap and its unit. They SHALL read the global config each time, so a change on the page applies at the next call.

#### Scenario: Agent reads the length

- **WHEN** the cap is 800 characters and the agent calls `memory` with mode `help`
- **THEN** the result holds note length `short`, cap 800 and unit `characters`

#### Scenario: Cap changed during a session

- **WHEN** the user saves Long on the page and the agent then calls `help`
- **THEN** the result holds note length `long`
