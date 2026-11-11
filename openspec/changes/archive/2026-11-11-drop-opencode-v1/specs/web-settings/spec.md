## MODIFIED Requirements

### Requirement: Advanced source selection reads local history safely

Advanced options SHALL let the user choose a Pi sessions directory, one Pi `.jsonl` session file, or one OpenCode database file. On every bind, the page SHALL accept an absolute path, including a path on a mounted volume. Only on a loopback bind SHALL the page also offer a server-side browser. The browser SHALL start at the host's default location, list one folder at a time, show only subfolders and eligible files, and hide symlinked entries. The page SHALL NOT upload files from the browser.

The server SHALL reject relative paths, paths with `..` segments, and unsupported formats. It SHALL resolve accepted paths to their real path, so symlinks at or above the chosen path are allowed. Symlinked entries inside a Pi folder SHALL be skipped. It SHALL pin the source's real path, device, and inode, and SHALL refuse a job when these have changed since validation.

The source, session list, and job endpoints SHALL be JSON `POST`s under the Settings mutation rules, apart from the side-effect-free readiness check. They SHALL return metadata only, and errors SHALL NOT contain file contents. Pi header reads SHALL be bounded to the start of each file. A selected Pi file SHALL be validated and imported as one session. A Pi file whose loaded session ID differs from its header ID SHALL be reported as a load error. A selected OpenCode database SHALL first list its contained top-level sessions. The schema check SHALL accept a database that has the OpenCode V2 session tables, and an older copy that has only the V1 tables.

Original history files and OpenCode database, WAL, and shared-memory files SHALL remain unchanged. OpenCode snapshots SHALL be copied asynchronously and SHALL be cancellable. The server SHALL check free space before copying. A snapshot SHALL be reused by the listing, the preview, and the import of the same source. It SHALL be removed on success, failure, cancellation, expiry, and shutdown. When the web server starts, and before each new copy, snapshots left by processes that no longer run SHALL be removed.

#### Scenario: Choosing a Pi session file

- **WHEN** the user chooses one valid `.jsonl` session file
- **THEN** the page SHALL list that session only
- **AND** preview and import SHALL read only that file

#### Scenario: Choosing an OpenCode database

- **WHEN** the user chooses a file that passes the OpenCode database schema check
- **THEN** the page SHALL list its top-level sessions for selection
- **AND** it SHALL NOT treat the database as one session

#### Scenario: A large OpenCode source needs a snapshot

- **WHEN** the OpenCode database has a write-ahead log (WAL) and temporary space is less than the database size plus the WAL size plus a margin
- **THEN** the page SHALL show an actionable space error with the needed and available sizes before copying
- **AND** the original database, WAL, and shared-memory files SHALL remain unchanged

#### Scenario: Preview and import of a large database copy it once

- **WHEN** the user lists, previews, and imports sessions from one OpenCode database with a WAL
- **THEN** the database SHALL be copied at most once
- **AND** the web UI SHALL keep responding while the copy runs

#### Scenario: A snapshot is left behind by a crash

- **WHEN** OpenCode stops during an import and leaves a snapshot folder
- **THEN** the next web server start, or the next snapshot copy from the CLI, SHALL remove that folder
- **AND** it SHALL NOT remove a snapshot owned by a running process

#### Scenario: The default Pi folder is a symlink

- **WHEN** the Pi sessions folder, or one of its parent folders, is a symlink to another volume
- **THEN** the source SHALL be accepted through its real path

#### Scenario: A source path is unsupported

- **WHEN** the user enters a relative path, a path with `..` segments, or a file with the wrong format
- **THEN** the page SHALL refuse the source without returning its contents

#### Scenario: Browsing from the network

- **WHEN** the server is bound to a non-loopback host and a request asks to browse folders
- **THEN** the server SHALL refuse it and the page SHALL offer only the path field

#### Scenario: Choosing an older V1-only database copy

- **WHEN** the user chooses an OpenCode database copy that has the V1 tables and no `session_v2` table
- **THEN** the page SHALL list its top-level sessions for selection

### Requirement: The Memory card shows editable limits and their effects

The Memory page SHALL show one **Memory limits** card with an editable table. Its headings SHALL be **Setting**, **Value**, **Default**, **Unit**, and **Affects**. Each row SHALL show the exact config identifier, an accessible numeric input for the saved global value, the default, its unit, and a visible explanation of what it changes.

The rows SHALL cover:

| Setting                      | Default                                        | Unit               | Affects                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxMemories`                | 10                                             | Results            | Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.                                                                                      |
| `autoCaptureMaxContextBytes` | 131072                                         | Bytes              | Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.                                                        |
| `userProfileMaxContextBytes` | 32768                                          | Bytes              | OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.                                              |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories.                              |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Lowest score a memory needs to be returned by search. Lower values return more memories, including less relevant ones. Higher values can return none. The default depends on the embedder. |

The **Affects** text SHALL stay visible, rather than being available only through a tooltip. The card SHALL explain that the byte controls count UTF-8 bytes, and that approximate tokens use `ceil(bytes / 4)` and can differ from the model's count. It SHALL state that these controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output. It SHALL name `~/.config/omms/omms.jsonc` as the file users can edit without the web UI.

The card SHALL use the existing table appearance and support horizontal scrolling within the card on narrow screens. Its title SHALL be H2 using the shared section-title role; any subsection headings SHALL use H3 and the shared subsection-title role. The application SHALL retain its single H1, and table labels and effect text SHALL remain table content. Every input SHALL have a label and associated validation message. Headings, effects, help, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic; config identifiers SHALL remain literal and readable left-to-right.

#### Scenario: Reading the default limits

- **WHEN** the user opens Memory limits with no saved overrides
- **THEN** the five rows SHALL show defaults of 10, 131072, 32768, 2000, and 0.5 (0.6 when the embedder is not `qwen3-embedding:0.6b`)
- **AND** each input SHALL have its effect and unit visible beside it

#### Scenario: Reading host-specific effects

- **WHEN** a Pi user reads the profile-input row
- **THEN** the page SHALL explain its existing host coverage
- **AND** it SHALL NOT suggest that the setting limits Pi's profile-learning input
- **AND** no row SHALL name `chatMessage.maxMemories` or OpenCode V1

#### Scenario: Viewing a narrow Arabic layout

- **WHEN** the user opens Memory limits in Arabic on a narrow screen
- **THEN** the table SHALL remain usable without forcing the whole page wider
- **AND** the config identifiers SHALL retain their technical order
- **AND** the effect explanations and input labels SHALL appear in Arabic

#### Scenario: Editing the threshold

- **WHEN** the user enters 0.45 for `similarityThreshold` and saves
- **THEN** the global file SHALL contain `"similarityThreshold": 0.45`
- **AND** the input SHALL accept decimals for this row only

#### Scenario: The default follows the embedder

- **WHEN** the embedder is the built-in model and the file has no `similarityThreshold`
- **THEN** the row SHALL show a default of 0.6 and a value of 0.6
- **AND** after the user switches to `qwen3-embedding:0.6b`, the row SHALL show 0.5

#### Scenario: Threshold outside the range

- **WHEN** the user enters -0.1, 1.1, or a blank value for `similarityThreshold`
- **THEN** the input SHALL show an associated validation message
- **AND** Save SHALL be disabled

### Requirement: The Memory card saves limits through the existing safe config flow

The Memory limits card SHALL offer **Save** and **Cancel**. Save SHALL be available only when a valid draft differs from the loaded global values. Cancel SHALL restore the loaded values without writing. While a save runs, the card SHALL prevent duplicate submissions and show its result. Successful saves SHALL refresh the shared Settings revision used by both pages.

The save SHALL use the existing Settings authentication, origin, JSON request, validation, conflict, and legacy-file rules. It SHALL change only edited values in the global config. A save SHALL preserve every unrelated key and its comments. A save SHALL NOT create a literal dotted key or allow arbitrary nested settings to be edited, and the server SHALL reject `chatMessage.maxMemories` as an unsupported edit.

The card SHALL show the effective value and the source when the selected project's config overrides a row. It SHALL still edit the global value and SHALL say that the project override remains in force. Values SHALL follow the validation and next-operation behaviour of the memory-context-controls capability. A rejected save SHALL leave the file unchanged and show the setting's accepted values, or the stale-file recovery action.

#### Scenario: Saving one nested value

- **WHEN** a request to save Memory limits tries to edit `chatMessage.maxMemories`
- **THEN** the server SHALL reject that unsupported edit without writing any part of the request
- **AND** the `chatMessage` object and its comments SHALL be unchanged

#### Scenario: Rejecting an unrelated nested edit

- **WHEN** a request to save Memory limits also tries to edit `chatMessage.enabled`
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

- **WHEN** Memory limits saves successfully and the user then saves a model choice on Settings
- **THEN** the other card SHALL use the refreshed Settings revision
- **AND** its save SHALL NOT fail solely because Memory limits changed the revision

### Requirement: Each Memory limit can be reset to its default

Each row of the Memory limits card SHALL offer **Reset to default**. Selecting it SHALL remove that key from the global config through the existing safe save flow (authentication, origin, JSON request, validation, conflict, and legacy-file rules), so the value follows the default again. A row whose saved value differs from its default SHALL show a visible marker with the text **Differs from default**. A row with no saved value, or one equal to the default, SHALL show no marker, and its Reset action SHALL be disabled when the key is absent from the file. Reset SHALL NOT change a project file.

#### Scenario: Resetting the threshold

- **WHEN** the file has `"similarityThreshold": 0.6`, the embedder is `qwen3-embedding:0.6b`, and the user selects **Reset to default** on that row
- **THEN** the `similarityThreshold` line SHALL be removed from the global file
- **AND** the row SHALL then show 0.5 and no marker

#### Scenario: Resetting a nested value

- **WHEN** the global file still has `"maxMemories": 3` inside its `chatMessage` object
- **THEN** the card SHALL show no row and no Reset action for it
- **AND** a reset of another row SHALL leave the `chatMessage` object and its comments unchanged

#### Scenario: Marker for a changed value

- **WHEN** the saved `maxMemories` is 6 and the default is 10
- **THEN** the row SHALL show **Differs from default**

#### Scenario: Nothing to reset

- **WHEN** a key is absent from the file
- **THEN** its Reset action SHALL be disabled

#### Scenario: Another editor changes the file

- **WHEN** another process changes the file before a reset is saved
- **THEN** the reset SHALL be refused without writing
- **AND** the card SHALL reload the current values
