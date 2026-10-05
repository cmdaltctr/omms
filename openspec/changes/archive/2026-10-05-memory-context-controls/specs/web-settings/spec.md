# Web settings delta

## ADDED Requirements

### Requirement: The Memory card shows editable limits and their effects

The Settings page SHALL show one **Memory** card with an editable table. Its headings SHALL be **Setting**, **Value**, **Default**, **Unit**, and **Affects**. Each row SHALL show the exact config identifier, an accessible numeric input for the saved global value, the default, its unit, and a visible explanation of what it changes.

The rows SHALL cover:

| Setting                      | Default | Unit               | Affects                                                                                                                                                       |
| ---------------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxMemories`                | 10      | Results            | Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.                                                         |
| `chatMessage.maxMemories`    | 3       | Memories           | Recent memories added at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 use prompt-based search instead.                                    |
| `autoCaptureMaxContextBytes` | 131072  | Bytes              | Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.                           |
| `userProfileMaxContextBytes` | 32768   | Bytes              | OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.                 |
| `retrievalMaxTokens`         | 2000    | Approximate tokens | Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories. |

The **Affects** text SHALL stay visible, rather than being available only through a tooltip. The card SHALL explain that the byte controls count UTF-8 bytes, and that approximate tokens use `ceil(bytes / 4)` and can differ from the model's count. It SHALL state that these controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output. It SHALL name `~/.config/omms/omms.jsonc` as the file users can edit without the web UI.

The card SHALL use the existing table appearance and support horizontal scrolling within the card on narrow screens. Its title SHALL be H2 using the shared section-title role; any subsection headings SHALL use H3 and the shared subsection-title role. The application SHALL retain its single H1, and table labels and effect text SHALL remain table content. Every input SHALL have a label and associated validation message. Headings, effects, help, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic; config identifiers SHALL remain literal and readable left-to-right.

#### Scenario: Reading the default limits

- **WHEN** the user opens Memory with no saved overrides
- **THEN** the five rows SHALL show defaults of 10, 3, 131072, 32768, and 2000
- **AND** each input SHALL have its effect and unit visible beside it

#### Scenario: Reading host-specific effects

- **WHEN** a Pi user reads the recent-memory and profile-input rows
- **THEN** the page SHALL explain their existing host coverage
- **AND** it SHALL NOT suggest that either setting limits Pi's profile-learning input

#### Scenario: Viewing a narrow Arabic layout

- **WHEN** the user opens Memory in Arabic on a narrow screen
- **THEN** the table SHALL remain usable without forcing the whole page wider
- **AND** the config identifiers SHALL retain their technical order
- **AND** the effect explanations and input labels SHALL appear in Arabic

### Requirement: The Memory card saves limits through the existing safe config flow

The Memory card SHALL offer **Save** and **Cancel**. Save SHALL be available only when a valid draft differs from the loaded global values. Cancel SHALL restore the loaded values without writing. While a save runs, the card SHALL prevent duplicate submissions and show its result. Successful saves SHALL refresh the shared Settings revision.

The save SHALL use the existing Settings authentication, origin, JSON request, validation, conflict, and legacy-file rules. It SHALL change only edited values in the global config. Saving `chatMessage.maxMemories` SHALL update that nested property while preserving the other `chatMessage` properties, their comments, and every unrelated key. A save SHALL NOT create a literal `chatMessage.maxMemories` key or allow arbitrary nested settings to be edited.

The card SHALL show the effective value and the source when the selected project's config overrides a row. It SHALL still edit the global value and SHALL say that the project override remains in force. Values SHALL follow the validation and next-operation behaviour of the memory-context-controls capability. A rejected save SHALL leave the file unchanged and show the setting's accepted values, or the stale-file recovery action.

#### Scenario: Saving one nested value

- **WHEN** the user changes `chatMessage.maxMemories` from 3 to 2 and saves
- **THEN** the global file SHALL contain `"maxMemories": 2` inside its `chatMessage` object
- **AND** `enabled`, `injectOn`, `excludeCurrentSession`, `maxAgeDays`, and their comments SHALL be unchanged
- **AND** the top-level `maxMemories` SHALL be unchanged

#### Scenario: Rejecting an unrelated nested edit

- **WHEN** a request to save Memory values also tries to edit `chatMessage.enabled`
- **THEN** the server SHALL reject that unsupported edit without writing any part of the request

#### Scenario: Invalid numeric input

- **WHEN** the user enters a blank value, negative value, fractional value, or value outside the accepted range
- **THEN** the input SHALL show an associated validation message
- **AND** Save SHALL be disabled
- **AND** the server SHALL also reject the invalid value if submitted directly

#### Scenario: Cancelling a draft

- **WHEN** the user edits two values and selects Cancel
- **THEN** both inputs SHALL return to their loaded values
- **AND** the config file SHALL remain unchanged

#### Scenario: Another editor changes the file

- **WHEN** another process changes `omms.jsonc` before the card saves its draft
- **THEN** the save SHALL be refused without writing
- **AND** the card SHALL load the current values and ask the user to review and save again

#### Scenario: The project overrides the global budget

- **WHEN** the project budget is 1000 and the user saves a global budget of 3000
- **THEN** the card SHALL show global 3000 and effective project 1000
- **AND** the project file SHALL remain unchanged

#### Scenario: Saving another card after Memory

- **WHEN** Memory saves successfully and the user then saves a model choice on another card
- **THEN** the other card SHALL use the refreshed Settings revision
- **AND** its save SHALL NOT fail solely because Memory changed the revision

### Requirement: The Settings sidebar navigates to the Memory card

The Settings sidebar tree SHALL contain one **Memory** child linked to `/settings#settings-section-memory`. Selecting it SHALL open Settings when necessary and bring the Memory card into view. Direct navigation and reload at that URL SHALL reveal the same card. Desktop collapse and mobile drawer behaviour SHALL remain consistent with the existing Settings children. Other Settings cards SHALL keep their existing anchors. Host-specific Directory maps links SHALL still reveal and focus the matching host disclosure without resetting unsaved map targets or selections.

#### Scenario: Opening Memory from the project view

- **WHEN** the user selects Memory in the Settings tree while viewing project memories
- **THEN** Settings SHALL open with the Memory card in view

#### Scenario: Following a saved link

- **WHEN** the user opens or reloads `/settings#settings-section-memory`
- **THEN** the Memory card SHALL be brought into view after the page mounts

#### Scenario: Directory maps navigation remains available

- **WHEN** the user opens Memory and then follows a Pi, OpenCode, or Claude Code unresolved-import link
- **THEN** the matching host's Directory maps disclosure SHALL open and receive focus
- **AND** unsaved map targets and selections SHALL remain unchanged

#### Scenario: Finding Memory in the sidebar

- **WHEN** the Settings tree is expanded on desktop or in the mobile drawer
- **THEN** Memory SHALL appear once as a child of Settings
- **AND** its accessible label SHALL use the page's language
