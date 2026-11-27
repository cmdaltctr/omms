## ADDED Requirements

### Requirement: Memorisation text renders as Markdown

When the user opens a memorisation card, the page SHALL render the full stored text as Markdown with the same renderer, sanitising and text style as the project memory cards. Headings, bullet lists, numbered lists, emphasis, inline code and code blocks SHALL render. The page SHALL remove scripts and other unsafe HTML from the text before it shows it. Plain text with no Markdown SHALL keep each line break.

#### Scenario: Structured note

- **WHEN** the user opens a memorisation whose text has a `## Plan` heading and three `-` bullet lines
- **THEN** the panel shows a Plan heading and a bullet list with three items

#### Scenario: Unsafe HTML

- **WHEN** the user opens a memorisation whose text contains `<script>alert(1)</script>`
- **THEN** the panel shows no script element and runs no script

#### Scenario: Snapshot saved before the change

- **WHEN** the user opens a memorisation stored as `Topic: release`, `Done: tagged` and `Next: publish` lines
- **THEN** the panel shows the three lines on separate lines

### Requirement: Memorisation card title is plain text

The card title SHALL be plain text with no Markdown symbols. The page SHALL take the text of a legacy `Topic:` line when the record has one. Otherwise it SHALL take the first non-empty line. It SHALL remove heading marks, emphasis marks, inline-code marks, list markers and link syntax from the title, and keep the link text.

#### Scenario: Note with a heading first

- **WHEN** a memorisation starts with the line `## OMRS harness **Docker** image`
- **THEN** the card title reads "OMRS harness Docker image"

#### Scenario: Snapshot saved after the change

- **WHEN** a memorisation starts with the line "omms release" followed by a `## Done` section
- **THEN** the card title reads "omms release"

#### Scenario: Snapshot saved before the change

- **WHEN** a memorisation has the line `Topic: release` after other lines
- **THEN** the card title reads "release"

### Requirement: Note length presets on the page

The Size cap card SHALL show a **Short**, **Medium**, **Long** or **Custom** choice above the number box. Each preset SHALL show its saved value in the chosen unit. Choosing a preset SHALL fill the number box with that value. Typing a number that matches no preset SHALL select **Custom**. Changing the unit while a preset is selected SHALL fill that preset's value in the new unit. Saving the cap SHALL write only `memorisationMaxSize` and `memorisationSizeUnit`.

#### Scenario: Choose Short

- **WHEN** the presets are the defaults and the user chooses **Short** with **Characters** and saves
- **THEN** the number box shows 800 and the global config holds `memorisationMaxSize: 800`

#### Scenario: Type a custom number

- **WHEN** the user types 3000 in the number box
- **THEN** **Custom** is selected

#### Scenario: Saved value matches a preset

- **WHEN** the saved cap is 500 tokens and the user opens the page
- **THEN** **Medium** and **Tokens** are selected

#### Scenario: Switch unit on a preset

- **WHEN** **Long** is selected with **Characters** and the user chooses **Tokens**
- **THEN** the number box shows 1250 and **Long** stays selected

### Requirement: Edit the preset values on the page

The Size cap card SHALL have an **Edit presets** button. It SHALL open three number boxes for Short, Medium and Long, in characters, each with its token estimate beside it, plus **Save**, **Cancel** and **Reset presets**. Save SHALL write `memorisationShortSize`, `memorisationMediumSize` and `memorisationLongSize` to the global config. When the selected preset's value changes, Save SHALL also write the new cap, so that preset stays selected.

#### Scenario: Edit the selected preset

- **WHEN** **Short** is selected with a cap of 800 characters, and the user sets Short to 1000 in the editor and saves
- **THEN** the global config holds `memorisationShortSize: 1000` and `memorisationMaxSize: 1000`, and **Short** stays selected

#### Scenario: Edit another preset

- **WHEN** **Medium** is selected, and the user sets Long to 8000 and saves
- **THEN** the global config holds `memorisationLongSize: 8000`, the cap is unchanged, and **Long** shows 8000

#### Scenario: Token estimate beside each box

- **WHEN** the user types 1000 in the Short box
- **THEN** the box shows "about 250 tokens" beside it

### Requirement: Preset editor checks, reset and cancel

The preset editor SHALL show the broken rule and SHALL NOT save when a value is out of range, the presets are out of order, or two presets have the same token value. **Reset presets** SHALL fill 800, 2000 and 5000 in the boxes without saving. **Cancel** SHALL close the boxes without a write.

#### Scenario: Out of order

- **WHEN** the user sets Short to 2500 while Medium is 2000
- **THEN** the editor says Short must be less than Medium and saves nothing

#### Scenario: Same token value

- **WHEN** the user sets Short to 1997 while Medium is 2000
- **THEN** the editor says Short and Medium must differ by at least one token and saves nothing

#### Scenario: Reset

- **WHEN** the user presses **Reset presets** and then **Save**
- **THEN** the global config holds 800, 2000 and 5000

#### Scenario: Cancel

- **WHEN** the user changes Short in the editor and presses **Cancel**
- **THEN** the boxes close and the global config is unchanged
