# Spec Delta

## ADDED Requirements

### Requirement: The Memory basics card holds the main switches

The Settings page SHALL show a **Memory basics** card first. It SHALL have controls for capture (`autoCaptureEnabled`), recall (`chatMessage.enabled`), visible recall (`visibleRecall`), profile injection (`injectProfile`) and the default memory scope (`memory.defaultScope`, **This project** or **All projects**). Saving SHALL write the global config. When the current project file sets one of these keys, the row SHALL say that the project file decides it there.

#### Scenario: Turning recall off

- **WHEN** the user turns recall off and saves
- **THEN** the global config SHALL have `chatMessage.enabled` set to `false`
- **AND** the other `chatMessage` keys SHALL keep their values

#### Scenario: A project overrides capture

- **WHEN** the global capture switch is on and the current project file sets `autoCaptureEnabled` to `false`
- **THEN** the capture row SHALL say that this project's file turns capture off

### Requirement: The Memory cleanup card shows the cleanup with a warning

The Settings page SHALL show a **Memory cleanup** card with an `autoDeleteOldMemories` switch and `autoCleanupRetentionDays`. It SHALL say in plain words that deletion removes unpinned memories not updated in that many days, in every project, and that a deleted memory cannot be restored. It SHALL say that a project file cannot change these settings. The page SHALL NOT write `autoCleanupEnabled`.

#### Scenario: Reading the default

- **WHEN** the user opens the card and the file does not set `autoDeleteOldMemories`
- **THEN** the switch SHALL be off
- **AND** the warning SHALL be visible

### Requirement: The Memory cleanup card explains the retired key

When the global file sets `autoCleanupEnabled` to `true` and does not set `autoDeleteOldMemories`, the Memory cleanup card SHALL show one plain note: the old setting no longer deletes anything, and the switch on this card turns deletion on. The page SHALL NOT rewrite the file on its own.

#### Scenario: A file from an older version

- **WHEN** the global file sets `"autoCleanupEnabled": true` and has no `autoDeleteOldMemories`
- **THEN** the card SHALL show the note and the switch SHALL be off
- **AND** the file SHALL remain unchanged until the user saves

### Requirement: Turning on cleanup asks for confirmation with a count

Saving the deletion switch on, or a smaller number of days while it is on, SHALL first open a confirm dialog. The dialog SHALL state how many memories the next daily check would delete with those days, from the count OMMS returns, and that the deletion happens at that check, not when the user saves. Nothing SHALL be saved until the user confirms. When the count cannot be read, the dialog SHALL say so and SHALL NOT allow the switch to be saved on.

#### Scenario: Turning deletion on

- **WHEN** 12 memories are older than 30 days and the user turns deletion on with 30 days and saves
- **THEN** the dialog SHALL say that 12 memories have not changed for 30 days and OMMS deletes them at its next daily check
- **AND** the config SHALL stay unchanged until the user confirms
- **AND** on confirm the global config SHALL have `autoDeleteOldMemories` set to `true`

#### Scenario: Cancelling the dialog

- **WHEN** the user turns the switch on, saves, and then selects Cancel in the dialog
- **THEN** nothing SHALL be saved
- **AND** the switch SHALL return to its saved state

#### Scenario: A rejected days value keeps deletion off

- **WHEN** the file sets `autoDeleteOldMemories` to `true` and `autoCleanupRetentionDays` to a value OMMS rejects
- **THEN** the card SHALL show the switch off for this load
- **AND** the card SHALL show one plain line that says why and points to the banner

### Requirement: The Settings page reports a config file problem

When OMMS records a config problem, the Settings page SHALL show a banner above the cards. For a file it cannot read the banner SHALL lead with one plain sentence in the page language, then name the file, line and column once as small text. It SHALL say which values OMMS uses until the file is fixed, or which feature is off for a fail-safe key. When the global file cannot be read, the page SHALL show the banner instead of failing with no detail, and SHALL disable saving.

#### Scenario: The page words the sentence itself

- **WHEN** the snapshot reports a parse problem with `file`, `line` and `column`
- **THEN** the page SHALL build the sentence from those fields in the page language
- **AND** the page SHALL NOT show the server's English `message`

#### Scenario: A syntax error in the global file

- **WHEN** the global file has a syntax error on line 7, column 3
- **THEN** the page SHALL show the banner with one translated sentence, then the file path, line 7 and column 3 once as small text
- **AND** every Save and Apply button on the Settings and Memory pages SHALL be disabled, with one plain reason shown beside it

#### Scenario: A problem that names no file

- **WHEN** a recorded problem names a key but no file
- **THEN** the banner SHALL show the key and the values it accepts
- **AND** the banner SHALL NOT show an empty file name

### Requirement: The read-only view shows the values OMMS uses

While the global file cannot be read, the cards SHALL show the last settings OMMS could read, and the banner SHALL say so. No row SHALL be labelled with a default that OMMS does not use.

#### Scenario: Values while the file is broken

- **WHEN** the last good file set `chatMessage.enabled` to `false` and a later edit breaks the file
- **THEN** the Memory basics card SHALL show recall off, from the last good file
- **AND** the banner SHALL say that the cards show the last settings OMMS could read

### Requirement: The banner leads with plain words for a rejected value

For a rejected value the banner SHALL lead with a plain sentence that uses the setting's plain name and says, in the page language, which values the key accepts. The key, the file and the line SHALL follow as small secondary text.

#### Scenario: A rejected value on the Arabic page

- **WHEN** the page language is Arabic and `retrievalMaxTokens` holds a value out of range
- **THEN** the banner SHALL say in Arabic which numbers the key accepts
- **AND** the key `retrievalMaxTokens` SHALL show as small secondary text after the sentence

### Requirement: A search result moves focus to its card

When the user chooses a search result, the page SHALL scroll to the card and SHALL move keyboard focus to the card heading, or to the summary of a Shared row on the Memory page.

#### Scenario: Choosing a result with the keyboard

- **WHEN** the user types `reranker` in the search box and presses Enter on the first result
- **THEN** the Memory page SHALL open at the Reranker row
- **AND** focus SHALL move from the search box to the row's summary

### Requirement: The Settings page finds any setting

The Settings page SHALL have a search box above the cards. Typing SHALL list each setting the web UI can change whose plain name, description or config key matches, on any page, with the page it is on. Choosing a result SHALL open that page and scroll to the card. When nothing matches, the list SHALL say that some settings live only in the config file and name the Configuration guide.

#### Scenario: Searching for a setting on another page

- **WHEN** the user types `reranker`
- **THEN** the list SHALL show the reranker settings on the Memory page
- **AND** choosing one SHALL open the Memory page at the Reranker card

### Requirement: Search finds retired keys and plain Arabic

A search for a retired key SHALL find the setting that replaced it, first. Arabic typed without short vowels SHALL match the same settings as Arabic with them.

#### Scenario: Searching for the retired cleanup key

- **WHEN** the user types `autoCleanupEnabled`
- **THEN** the first result SHALL be the Memory cleanup switch

### Requirement: Each setting row explains the setting in plain words

Each setting row on the Settings page and in the shared Memory page cards SHALL show a plain name, a one-line description, the default and what it affects. The default SHALL be the value the server uses when the config file sets nothing. The config key SHALL show as small secondary text, left-to-right. These texts SHALL exist in English, Chinese and Arabic. Every search anchor SHALL be an element id on its page.

#### Scenario: Reading a limit row

- **WHEN** the user reads the Memory limits row for `autoCaptureMaxContextBytes`
- **THEN** the row SHALL lead with a plain name
- **AND** `autoCaptureMaxContextBytes` SHALL appear only as secondary text

### Requirement: Codes and provider ids are shown in plain words

The page SHALL show a sentence for each reranker failure code, and a display name for each memory provider id, such as **OpenAI Chat Completions** for `openai-chat`. An unknown code SHALL show a general sentence with the code as secondary text.

#### Scenario: The reranker cannot be reached

- **WHEN** a reranker test fails with `reranker_unreachable`
- **THEN** the card SHALL say that OMMS could not reach the reranker server, and suggest checking the URL and that the server runs

### Requirement: One key-entry control serves every key

The External API, Embedding and Reranker cards SHALL use one key-entry control with the choices **Environment variable**, **Key file** and **Save key to a private file**, plus **No key** where a key is optional. Each card SHALL show that a login web app does not see variables set only in a shell profile. A pasted key SHALL follow the same private file and redaction rules as the External API key.

#### Scenario: Pasting a reranker key

- **WHEN** the user pastes a key in the Reranker card and saves
- **THEN** the key SHALL be written to a user-only file under `~/.config/omms/secrets/`
- **AND** `rerankerApiKey` SHALL be set to `file://` with that path

#### Scenario: Testing a pasted reranker key

- **WHEN** the user pastes a reranker key and presses Test without saving
- **THEN** the test SHALL send that key to the reranker server for that request only
- **AND** the key SHALL NOT be written to a file, the config, the log or the reply
- **AND** on a network host without Basic Auth the test SHALL be refused with a plain reason, as the External API test is

#### Scenario: The card says whether the web app can read the key

- **WHEN** `rerankerApiKey` or `embeddingApiKey` names an environment variable that the web app does not have
- **THEN** the settings snapshot SHALL report that the web app cannot read the key, without the value
- **AND** the card SHALL say so

### Requirement: Every settings card saves the same way

Each settings card with a server SHALL test the values in the form, not the saved values. Each card SHALL save with a Save button, not on leaving a field, and SHALL show a plain message after each test and save. An optional URL or model field SHALL be clearable, which removes the key. Every URL field SHALL accept only `http://` or `https://` URLs. An invalid number SHALL show a message next to the field.

#### Scenario: Testing an unsaved model

- **WHEN** the user types a new model on the External API card and selects Test without saving
- **THEN** the test call SHALL use the typed model

#### Scenario: Clearing the API URL

- **WHEN** the user empties the API URL and saves
- **THEN** `memoryApiUrl` SHALL be removed from the global config

#### Scenario: A URL without a scheme

- **WHEN** the user saves `api.example.com/v1` as the API URL
- **THEN** the save SHALL be refused with a message that the URL must start with `http://` or `https://`

### Requirement: A save that deletes data asks first

A save that deletes stored data at once SHALL open a confirm dialog that states what will be deleted, with a count when one is known. Saving retry retention 0 SHALL read the waiting count again when Save is pressed and state how many waiting turns will be deleted. Nothing SHALL be saved until the user confirms.

#### Scenario: Turning the retry queue off

- **WHEN** 3 turns wait and the user sets retry retention to 0 and saves
- **THEN** a dialog SHALL say that 3 waiting turns will be deleted
- **AND** the config SHALL stay unchanged if the user cancels

### Requirement: Settings cards follow the shared control rules

The Settings page cards and the shared Memory page settings cards SHALL use the shared button, input, select, label and dialog controls. They SHALL NOT use a raw `<button>`, a raw `<input>`, an emoji icon, or `window.confirm`. A native switch (`role="switch"`) that stays in form state and saves with its card's Save button is the one allowed raw input.

#### Scenario: The embedding lock

- **WHEN** the user views the locked Embedding card
- **THEN** the lock control SHALL be a shared button with a Lucide icon and an accessible name

## MODIFIED Requirements

### Requirement: Capture diagnostics are shown and controlled on the page

The Settings page SHALL show capture diagnostics for a selectable time range: save, skip, and failure counts and rates for each host and model, failure counts by reason code, and a table of recent attempts with their diagnostics fields. It SHALL provide controls for `captureTrace`, `captureTraceRetentionDays`, `captureAttemptRetentionDays` and `captureRetryRetentionHours`, show the number of turns waiting in the capture retry queue for each host with a **Retry now** button for each host, list existing trace files with their date and size, and let the user view or delete a trace file. Next to the trace switch, it SHALL warn that traces can contain conversation content. The retention fields SHALL save with a Save button and SHALL show a message for an invalid value.

#### Scenario: Viewing failure reasons

- **WHEN** the user opens the diagnostics section with the last 7 days selected
- **THEN** the page SHALL show failure counts for each reason code and each model in that range

#### Scenario: Turning tracing on

- **WHEN** the user turns on the trace switch and saves
- **THEN** the global config SHALL have `captureTrace` set to `true`
- **AND** the next capture attempt on OpenCode, Pi or Claude Code SHALL write a trace entry, unless the project's config sets `captureTrace` to `false`

#### Scenario: A project has turned tracing off

- **WHEN** the global config turns tracing on and the current project's config sets `captureTrace` to `false`
- **THEN** capture attempts in that project SHALL NOT write trace entries
- **AND** the trace switch SHALL show that the project has tracing off

#### Scenario: Deleting a trace file

- **WHEN** the user deletes a trace file on the page
- **THEN** that file SHALL be removed and the list SHALL no longer show it

#### Scenario: Changing how long failed turns are kept

- **WHEN** the user sets retry retention to 24 hours and saves
- **THEN** the global config SHALL have `captureRetryRetentionHours` set to `24`
- **AND** running hosts SHALL use 24 hours from their next retry pass or daily housekeeping

#### Scenario: Seeing queued turns

- **WHEN** two Pi turns and no OpenCode turns wait in the retry queue
- **THEN** the diagnostics section SHALL show 2 queued turns for Pi and 0 for OpenCode

#### Scenario: Retry now while the host runs in the server's process

- **WHEN** two Pi turns wait, the Pi process runs the Web UI server, the API is reachable, and the user presses **Retry now** for Pi
- **THEN** both turns SHALL be retried at once
- **AND** the Pi queued count SHALL show 0 after the retries finish

#### Scenario: Retry now for a host in another process

- **WHEN** OpenCode turns wait and OpenCode does not run in the Web UI server's process, and the user presses **Retry now** for OpenCode
- **THEN** the page SHALL say the turns will retry at OpenCode's next session start
- **AND** those turns SHALL be due at that time regardless of their wait schedule

#### Scenario: Turning the queue off on the page

- **WHEN** turns wait in the queue, the user sets retry retention to 0, saves, and confirms the dialog
- **THEN** the queued counts SHALL show 0 for every host
- **AND** the **Retry now** buttons SHALL be disabled

#### Scenario: An invalid retention

- **WHEN** the user types 0 in the trace retention field
- **THEN** the field SHALL show that it accepts whole days of 1 or more
- **AND** Save SHALL be disabled

### Requirement: Settings are saved safely to the global config

Saving on the Settings page SHALL write only the changed keys to the global config file that OMMS is reading. When that file is the legacy `~/.config/opencode/opencode-mem.jsonc`, the first save SHALL create `~/.config/omms/omms.jsonc` as a copy of it, comments included, apply the change there, and tell the user that OMMS now reads the new file. The legacy file SHALL NOT be written. Saves SHALL run one at a time, and a save SHALL be rejected without writing when the file changed after the page read it. Saving SHALL keep comments, key order, and all other keys. It SHALL reject values that fail the same validation used at startup, and SHALL leave the file unchanged when it rejects them. Running OpenCode and Pi processes, and the web app that serves Claude Code, SHALL use the saved values from their next capture without a restart. The page SHALL NOT write project config files, and SHALL NOT write a key that is global-only to a project. It SHALL NOT read or show secret values; it SHALL show only whether a secret is set, its source type (literal, `env://`, or `file://`), and, for `env://` and `file://`, the variable name or file path. The page SHALL change `memoryApiKey`, `embeddingApiKey`, `rerankerApiKey` and the browser password only to an `env://` or `file://` reference, including one created by saving a pasted key to a private key file. It SHALL NOT save a literal key to the config.

#### Scenario: A commented config file is edited

- **WHEN** the user saves a new Pi model and the config file has comments
- **THEN** the comments and every other key SHALL remain unchanged

#### Scenario: The install still uses the legacy config file

- **WHEN** only `~/.config/opencode/opencode-mem.jsonc` exists and the user saves a new Pi model
- **THEN** `~/.config/omms/omms.jsonc` SHALL be created with every key and comment from the legacy file plus the new Pi model
- **AND** the legacy file SHALL be unchanged
- **AND** the page SHALL say that OMMS now reads `~/.config/omms/omms.jsonc`

#### Scenario: The file changed while the page was open

- **WHEN** the config file is edited by hand, or by another process, after the page read it and before the page saves
- **THEN** the save SHALL be rejected without writing
- **AND** the page SHALL reload the current settings and ask the user to save again

#### Scenario: An invalid value is saved

- **WHEN** the user saves a retention of `0` days
- **THEN** the save SHALL be rejected with the reason, and the file SHALL be unchanged

#### Scenario: The running host picks up a change

- **WHEN** Pi is running and the user saves a new Pi model on the page
- **THEN** Pi's next capture SHALL use the new model without a restart

#### Scenario: A secret is configured

- **WHEN** `memoryApiKey` is set to `env://OMMS_KEY`
- **THEN** the page SHALL show that the key is set from the environment variable `OMMS_KEY` and SHALL NOT show its value

#### Scenario: A literal key is submitted as a reference

- **WHEN** a request tries to save `memoryApiKey` or `rerankerApiKey` as a value that is not an `env://` or `file://` reference
- **THEN** the save SHALL be rejected and the file SHALL be unchanged

### Requirement: The page controls starting the web app at login

The Settings page SHALL have a **Web app** section with a switch for `webServerAutoStart`, the login item's status (installed, not installed, or unsupported on this platform), and the terminal commands that start the web app or manage the item. It SHALL say that the change applies at the next OpenCode or Pi start, or right away with `om-memory-system web install` or `web uninstall`, and that a user of Claude Code alone runs the command.

#### Scenario: Turning off start at login

- **WHEN** the user turns off the switch and saves
- **THEN** the global config SHALL have `webServerAutoStart` set to `false`
- **AND** the section SHALL say that the item is removed at the next OpenCode or Pi start, or at once with `om-memory-system web uninstall`

#### Scenario: Viewing the item status

- **WHEN** the login item is installed
- **THEN** the section SHALL show it as installed

### Requirement: The page configures the external API

The Settings page SHALL have an **External API** card that edits `memoryProvider`, `memoryApiUrl`, `memoryModel`, and `memoryApiKey` in the global config. The card SHALL say that OpenCode, Pi and Claude Code can use the endpoint. The provider SHALL be chosen from the providers OMMS supports, each shown by its display name. The card SHALL offer the key sources of the shared key-entry control:

- **Environment variable**: the user types a variable name, and the page saves `env://NAME`.
- **Key file**: the user types the path of an existing file, and the page saves `file://` with that path.
- **Save key to a private file**: the user pastes the key once. The server SHALL write it to a file under `~/.config/omms/secrets/`, create the folder if needed, restrict the file to the current user (mode `600` on macOS and Linux, a user-only access list on Windows), and save `file://` with that path. It SHALL replace an existing key file only after the user confirms in a dialog.

The key value SHALL NOT be written to `omms.jsonc`, the log, the capture trace, or any response, and the page SHALL NOT show it after saving. The card SHALL show the saved key source type and reference, whether the web app can read the key, and, for an environment variable, that a login web app does not see variables set only in a shell profile. A **Test** button SHALL make one small call with the provider, URL, model and key source in the form, saved or not, and report success or an error with the key redacted. **Save settings** SHALL check the key source in the page first and save the key before the URL and model, so a refused key saves nothing. After a save every key field SHALL be empty. Errors SHALL show in the page language. The API URL SHALL accept only `http://` or `https://` URLs, and the URL and model SHALL be clearable.

#### Scenario: Using an environment variable

- **WHEN** the user chooses Environment variable, types `ZAI_API_KEY`, and saves
- **THEN** the global config SHALL have `memoryApiKey` set to `env://ZAI_API_KEY`

#### Scenario: Saving a pasted key

- **WHEN** the user pastes a key, chooses Save key to a private file, and saves
- **THEN** the key SHALL be written to a user-only file under `~/.config/omms/secrets/`
- **AND** `memoryApiKey` SHALL be set to `file://` with that path
- **AND** no response or log line SHALL contain the key

#### Scenario: The variable is missing in the login web app

- **WHEN** `memoryApiKey` is `env://ZAI_API_KEY` and the login web app's process has no such variable
- **THEN** the card SHALL say that the web app cannot read the key and suggest a key file

#### Scenario: Saving a key the provider refuses

- **WHEN** the user selects Save settings and the test call with the form values gets HTTP 401 or 403
- **THEN** the card SHALL save nothing, neither the key nor the endpoint
- **AND** the card SHALL say in the page language that the provider refused the key and that nothing was saved, with the status as small text

#### Scenario: Saving while the provider cannot be reached

- **WHEN** the user selects Save settings and the test call fails with a network error or a timeout
- **THEN** the card SHALL open the shared confirm dialog with Save anyway and Cancel
- **AND** Cancel SHALL save nothing, and Save anyway SHALL save without a second test call

#### Scenario: A failed test in Arabic

- **WHEN** a test call fails with HTTP 404, 429 or a 5xx status
- **THEN** the card SHALL show one translated sentence for that status, with the status as small text
- **AND** the card SHALL never show the provider's reply

#### Scenario: Testing the endpoint

- **WHEN** the user clicks Test and the endpoint rejects the key
- **THEN** the card SHALL show the error with the key redacted

#### Scenario: Testing a pasted key before saving

- **WHEN** the user pastes a key and clicks Test without saving
- **THEN** the test SHALL use the pasted key in memory only
- **AND** no file, log line or response SHALL contain the key

### Requirement: The Embedding card changes the embedder behind a lock

The Settings page SHALL show an **Embedding** card with the embedder in use: kind, server URL, model, vector size (shown as **Vector size**, with a line saying it is the number of values the model returns for each memory), key status, and memory count. The fields SHALL be read-only until the user presses the lock button. Unlocked, the card SHALL offer **Built-in model** or **OpenAI-compatible server**. For a server it SHALL offer presets that fill the URL: llama.cpp (`http://localhost:8080/v1`), Ollama (`http://localhost:11434/v1`), OpenRouter (`https://openrouter.ai/api/v1`), OpenAI (`https://api.openai.com/v1`), and Custom. A preset SHALL fill the URL only and SHALL NOT change the model name. It SHALL take the exact model name as typed text, and an optional API key through the shared key-entry control. **Test** SHALL test the candidate and fill the vector size. **Apply** SHALL be enabled only after a passing test of the current values. **Apply** SHALL open a confirm dialog that states: every memory will be re-embedded, with the count; a hosted server is called once for each memory; search is poor until the re-embed ends; and open OpenCode and Pi sessions should be restarted. Confirming SHALL apply the change and show re-embed progress. A failed re-embed SHALL show the reason and a **Retry** button. Pressing the lock button again, or **Cancel**, SHALL discard unsaved edits.

#### Scenario: The card starts locked

- **WHEN** the user opens the Settings page
- **THEN** the Embedding card SHALL show the embedder in use with its fields read-only

#### Scenario: Ollama model name

- **WHEN** the user unlocks the card, chooses the Ollama preset, and types `nomic-embed-text`
- **THEN** the URL SHALL read `http://localhost:11434/v1` and the model SHALL read `nomic-embed-text`

#### Scenario: Switching to the built-in model

- **WHEN** the user unlocks a card that uses a server with model `qwen3-embedding:0.6b` and chooses **Built-in model**
- **THEN** the model SHALL read the default built-in model, not the server's model name

#### Scenario: A saved server without a key

- **WHEN** the embedder is a server with no saved key and the user unlocks the card
- **THEN** the API key choice SHALL show **No key** selected

#### Scenario: Apply needs a passing test

- **WHEN** the user edits the model name after a passing test
- **THEN** **Apply** SHALL be disabled until the user tests again

#### Scenario: Confirming the change

- **WHEN** the user presses **Apply** with 3,530 memories stored
- **THEN** the confirm dialog SHALL state that 3,530 memories will be re-embedded, and the other risks
- **AND** on confirm the card SHALL show progress until the re-embed ends

#### Scenario: The first preset

- **WHEN** the user unlocks the card and opens the preset list
- **THEN** llama.cpp SHALL be the first preset

### Requirement: The Memory card shows editable limits and their effects

The Memory page SHALL show one **Memory limits** card with an editable table. Its headings SHALL be **Setting**, **Value**, **Default**, **Unit**, and **Affects**. Each row SHALL show a plain name with the exact config identifier as small secondary text, an accessible numeric input for the saved global value, the default, its unit, and a visible explanation of what it changes.

The rows SHALL cover:

| Setting                      | Default                                        | Unit               | Affects                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxMemories`                | 10                                             | Results            | Maximum memory search results. Manual searches can request fewer; prompt retrieval uses this ceiling.                                                                                      |
| `autoCaptureMaxContextBytes` | 131072                                         | Bytes              | Conversation input sent to the memory-summary model through the shared capture pipeline. Smaller values can omit conversation text.                                                        |
| `userProfileMaxContextBytes` | 32768                                          | Bytes              | OpenCode profile-learning input. Smaller values can omit prompts from that input. This control does not limit the other hosts' profile input.                                              |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | Automatic memory context, including profile text and formatting, added to agent requests across all hosts. Smaller values can show fewer or shorter memories.                              |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Lowest score a memory needs to be returned by search. Lower values return more memories, including less relevant ones. Higher values can return none. The default depends on the embedder. |

The **Affects** text SHALL stay visible, rather than being available only through a tooltip. The card SHALL explain in plain words that byte limits count the size of the text, and that OMMS estimates one token for about four bytes, so the model's own count can differ. It SHALL state that these controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output. It SHALL name `~/.config/omms/omms.jsonc` as the file users can edit without the web UI.

The card SHALL use the existing table appearance and support horizontal scrolling within the card on narrow screens. Its title SHALL be H2 using the shared section-title role; any subsection headings SHALL use H3 and the shared subsection-title role. The application SHALL retain its single H1, and table labels and effect text SHALL remain table content. Every input SHALL have a label and associated validation message. Plain names, headings, effects, help, feedback, and accessible names SHALL be translated into English, Chinese, and Arabic; config identifiers SHALL remain literal and readable left-to-right.

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
- **AND** the plain names, effect explanations and input labels SHALL appear in Arabic

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

### Requirement: The Memory page configures the opt-in reranker

The Memory page SHALL show a **Reranker** card below Memory limits. The card SHALL contain a switch labelled **Use a reranker**, off by default, and four fields: **Server URL** (`rerankerApiUrl`), **Model** (`rerankerModel`), **Key** (`rerankerApiKey`, optional, entered through the shared key-entry control), and **Timeout** (`rerankerTimeoutMs`, in milliseconds, default 4000, from 500 to 30000). The card SHALL say what the reranker does, that it sends the prompt and candidate memory text to the server URL, and that a server on the same machine is recommended. When the URL host is not a loopback address, the card SHALL show a visible notice that memory text leaves this machine.

The switch SHALL NOT be savable as on while the URL or model is blank. The card SHALL offer **Test**, **Save**, and **Cancel**. Test SHALL use the values in the form and report success or a failure in plain words, never prompt or memory text. Save SHALL use the existing Settings authentication, origin, JSON request, validation, conflict, and legacy-file rules, and SHALL change only the five reranker keys in the global config. The card SHALL say that a project file cannot change these settings.

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
- **AND** it SHALL show a plain sentence for the failure otherwise

#### Scenario: Remote server notice

- **WHEN** the user enters `https://rerank.example.com/v1`
- **THEN** the card SHALL show that memory text leaves this machine

#### Scenario: A key typed in plain text

- **WHEN** the user chooses Key file or Environment variable and enters a value that is not a valid name or path
- **THEN** the card SHALL refuse it and Save SHALL be disabled

#### Scenario: Timeout outside the range

- **WHEN** the user enters 100, 40000, 2500.5, or a blank value for **Timeout**
- **THEN** the field SHALL show a validation message
- **AND** Save SHALL be disabled

#### Scenario: Raising the timeout

- **WHEN** the user enters 6000 for **Timeout** and saves
- **THEN** the global file SHALL contain `"rerankerTimeoutMs": 6000`
