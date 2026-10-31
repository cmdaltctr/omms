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

The page SHALL list proposals with their state: pending, applied, applied automatically, rejected, stale or undone. A pending proposal SHALL show a line diff, the summary and its evidence turns, with **Apply** and **Reject**. An applied proposal SHALL offer **Undo**.

#### Scenario: Apply from the page

- **WHEN** the user selects **Apply** on a pending proposal
- **THEN** the proposal SHALL show `applied` and offer **Undo**

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
