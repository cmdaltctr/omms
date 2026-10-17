## MODIFIED Requirements

### Requirement: The Memory card shows editable limits and their effects

The Memory page SHALL show one **Memory limits** card with an editable table. Its headings SHALL be **Setting**, **Value**, **Default**, **Unit**, and **Affects**. Each row SHALL show the exact config identifier, an accessible numeric input for the saved global value, the default, its unit, and a visible explanation of what it changes.

The rows SHALL cover:

| Setting                      | Default                                        | Unit               | Affects                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxMemories`                | 10                                             | Results            | Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.                                                                                      |
| `chatMessage.maxMemories`    | 3                                              | Memories           | Recent memories added at session start in OpenCode V1 and Claude Code. Pi and OpenCode V2 use prompt-based search instead.                                                                 |
| `autoCaptureMaxContextBytes` | 131072                                         | Bytes              | Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.                                                        |
| `userProfileMaxContextBytes` | 32768                                          | Bytes              | OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.                                              |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories.                              |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Lowest score a memory needs to be returned by search. Lower values return more memories, including less relevant ones. Higher values can return none. The default depends on the embedder. |

The **Affects** text SHALL stay visible, rather than being available only through a tooltip. The card SHALL explain that the byte controls count UTF-8 bytes, and that approximate tokens use `ceil(bytes / 4)` and can differ from the model's count. It SHALL state that these controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output. It SHALL name `~/.config/omms/omms.jsonc` as the file users can edit without the web UI.

The card SHALL use the existing table appearance and support horizontal scrolling within the card on narrow screens. Its title SHALL be H2 using the shared section-title role; any subsection headings SHALL use H3 and the shared subsection-title role. The application SHALL retain its single H1, and table labels and effect text SHALL remain table content. Every input SHALL have a label and associated validation message. Headings, effects, help, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic; config identifiers SHALL remain literal and readable left-to-right.

#### Scenario: Reading the default limits

- **WHEN** the user opens Memory limits with no saved overrides
- **THEN** the six rows SHALL show defaults of 10, 3, 131072, 32768, 2000, and 0.5 (0.6 when the embedder is not `qwen3-embedding:0.6b`)
- **AND** each input SHALL have its effect and unit visible beside it

#### Scenario: Reading host-specific effects

- **WHEN** a Pi user reads the recent-memory and profile-input rows
- **THEN** the page SHALL explain their existing host coverage
- **AND** it SHALL NOT suggest that either setting limits Pi's profile-learning input

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

## ADDED Requirements

### Requirement: The Memory page configures the opt-in reranker

The Memory page SHALL show a **Reranker** card below Memory limits. The card SHALL contain a switch labelled **Use a reranker**, off by default, and four fields: **Server URL** (`rerankerApiUrl`), **Model** (`rerankerModel`), **Key** (`rerankerApiKey`, an `env://` or `file://` reference, optional), and **Timeout** (`rerankerTimeoutMs`, in milliseconds, default 2000, from 500 to 30000). The card SHALL say what the reranker does, that it sends the prompt and candidate memory text to the server URL, and that a server on the same machine is recommended. When the URL host is not a loopback address, the card SHALL show a visible notice that memory text leaves this machine.

The switch SHALL NOT be savable as on while the URL or model is blank. The card SHALL offer **Test**, **Save**, and **Cancel**. Test SHALL use the saved or drafted values and report success or a failure code, never prompt or memory text. Save SHALL use the existing Settings authentication, origin, JSON request, validation, conflict, and legacy-file rules, and SHALL change only the five reranker keys in the global config. The card SHALL say that a project file cannot change these settings.

#### Scenario: Reading the default state

- **WHEN** the user opens the Reranker card with no saved reranker settings
- **THEN** the switch SHALL be off
- **AND** the URL, model, and key fields SHALL be empty
- **AND** the card SHALL state that search is unchanged while the switch is off

#### Scenario: Turning it on without a server

- **WHEN** the user turns the switch on and leaves the URL blank
- **THEN** the card SHALL show a validation message
- **AND** Save SHALL be disabled

#### Scenario: Testing a server

- **WHEN** the user enters a URL and model and selects Test
- **THEN** the card SHALL send two sample documents to the server
- **AND** it SHALL show success only when the reply orders them correctly
- **AND** it SHALL show a failure code otherwise

#### Scenario: Remote server notice

- **WHEN** the user enters `https://rerank.example.com/v1`
- **THEN** the card SHALL show that memory text leaves this machine

#### Scenario: A key typed in plain text

- **WHEN** the user enters a key that is not an `env://` or `file://` reference
- **THEN** the card SHALL refuse it and Save SHALL be disabled

#### Scenario: Timeout outside the range

- **WHEN** the user enters 100, 40000, 2500.5, or a blank value for **Timeout**
- **THEN** the field SHALL show a validation message
- **AND** Save SHALL be disabled

#### Scenario: Raising the timeout

- **WHEN** the user enters 6000 for **Timeout** and saves
- **THEN** the global file SHALL contain `"rerankerTimeoutMs": 6000`

### Requirement: Each Memory limit can be reset to its default

Each row of the Memory limits card SHALL offer **Reset to default**. Selecting it SHALL remove that key from the global config through the existing safe save flow (authentication, origin, JSON request, validation, conflict, and legacy-file rules), so the value follows the default again. For `chatMessage.maxMemories` it SHALL remove only that leaf and keep the other `chatMessage` properties and their comments. A row whose saved value differs from its default SHALL show a visible marker with the text **Differs from default**. A row with no saved value, or one equal to the default, SHALL show no marker, and its Reset action SHALL be disabled when the key is absent from the file. Reset SHALL NOT change a project file.

#### Scenario: Resetting the threshold

- **WHEN** the file has `"similarityThreshold": 0.6`, the embedder is `qwen3-embedding:0.6b`, and the user selects **Reset to default** on that row
- **THEN** the `similarityThreshold` line SHALL be removed from the global file
- **AND** the row SHALL then show 0.5 and no marker

#### Scenario: Resetting a nested value

- **WHEN** the user resets `chatMessage.maxMemories`
- **THEN** only the `maxMemories` leaf inside `chatMessage` SHALL be removed
- **AND** `enabled`, `injectOn`, `excludeCurrentSession`, `maxAgeDays`, and their comments SHALL be unchanged

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
