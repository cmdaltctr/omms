## ADDED Requirements

### Requirement: The Embedding card changes the embedder behind a lock

The Settings page SHALL show an **Embedding** card with the embedder in use: kind, server URL, model, vector size, key status, and memory count. The fields SHALL be read-only until the user presses the padlock. Unlocked, the card SHALL offer **Built-in model** or **OpenAI-compatible server**. For a server it SHALL offer presets that fill the URL: Ollama (`http://localhost:11434/v1`), llama.cpp (`http://localhost:8080/v1`), OpenRouter (`https://openrouter.ai/api/v1`), OpenAI (`https://api.openai.com/v1`), and Custom. A preset SHALL fill the URL only and SHALL NOT change the model name. It SHALL take the exact model name as typed text, and an optional API key through the same key source choices as the External API card. **Test** SHALL test the candidate and fill the vector size. **Apply** SHALL be enabled only after a passing test of the current values. **Apply** SHALL open a confirmation that states: every memory will be re-embedded, with the count; a hosted server is called once for each memory; search is poor until the re-embed ends; and open OpenCode and Pi sessions should be restarted. Confirming SHALL apply the change and show re-embed progress. A failed re-embed SHALL show the reason and a **Retry** button. Pressing the padlock again, or **Cancel**, SHALL discard unsaved edits.

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
- **THEN** the confirmation SHALL state that 3,530 memories will be re-embedded, and the other risks
- **AND** on confirm the card SHALL show progress until the re-embed ends

### Requirement: The Keys and access card lists each credential

The Settings page SHALL show a **Keys and access** card, separate from the model cards. It SHALL list `memoryApiKey`, `embeddingApiKey`, API tokens, and the browser password, each with what it is for, which hosts use it, and where to change it. Each row SHALL show ✅ **set** when it has a value; ⛔️ **missing** when something in use needs it; or a grey label otherwise: **never used before** for `memoryApiKey`, and **not needed** for the other rows. `memoryApiKey` is needed when OpenCode or Pi uses the external API, or when there is evidence that Claude Code is in use: OMMS has recorded a Claude Code capture attempt, or the user has set the Claude Code folder on the page. A default Claude Code folder that exists on disk alone SHALL NOT count as evidence. `embeddingApiKey` is needed only when the embedder is a server whose address is not on this machine. API tokens are needed only when the web app listens on the network and Basic Auth is off. The browser password is never marked needed. The card SHALL NOT show any secret value.

#### Scenario: A local setup

- **WHEN** the web app listens on `127.0.0.1`, the external API key is set, and the embedder is a local server without a key
- **THEN** `memoryApiKey` SHALL show ✅ set
- **AND** `embeddingApiKey`, API tokens, and the browser password SHALL show grey not needed

#### Scenario: Claude Code installed but never used with OMMS

- **WHEN** `~/.claude/projects` exists, no Claude Code capture attempt is recorded, the Claude Code folder setting is empty, no host uses the external API, and `memoryApiKey` is not set
- **THEN** the `memoryApiKey` row SHALL show grey **never used before**

#### Scenario: Claude Code has sent a turn

- **WHEN** a Claude Code capture attempt is recorded and `memoryApiKey` is not set
- **THEN** the `memoryApiKey` row SHALL show ⛔️ missing

#### Scenario: Network binding without protection

- **WHEN** the web app listens on `0.0.0.0` with no token and no password
- **THEN** the API tokens row SHALL show ⛔️ missing

### Requirement: The page manages API tokens and the browser password

The Keys and access card SHALL include an API tokens table with **Generate token**, a name field, and an expiry choice of 7, 30, or 90 days or never. After a token is generated, the page SHALL show its value once with a copy button and a note that it will not be shown again. Each row SHALL have **Revoke**, which asks for confirmation. The card SHALL let the user set or clear the Basic Auth password and user name; a set password SHALL be saved to a private key file and referenced from the global config. These controls SHALL be hidden with a note when the page is not opened from the local machine.

#### Scenario: Generating a token

- **WHEN** the user enters `ci`, chooses 30 days, and presses **Generate token**
- **THEN** the page SHALL show the value once and add a row `ci` with its expiry

#### Scenario: Setting a browser password

- **WHEN** the user sets a password and saves
- **THEN** the global config SHALL reference a private key file for `webServerAuthPassword`
- **AND** the page SHALL NOT show the password after the save

### Requirement: Health checks cover Claude Code

The health checks SHALL include a **Claude Code model** row and a **Claude Code folder** row. The model row SHALL pass when the external API is fully configured, and SHALL fail with the missing settings otherwise. The folder row SHALL pass when the Claude Code transcripts folder in use exists, and SHALL warn with the folder path otherwise. When the user asks for model tests, the checks SHALL also include a **Claude Code model test** row that sends the fixed short prompt to the external API. One health run SHALL send at most one test call to the external API.

#### Scenario: Claude Code is ready

- **WHEN** the external API is fully configured and the transcripts folder exists, and the user runs the checks
- **THEN** the **Claude Code model** row and the **Claude Code folder** row SHALL show pass

#### Scenario: The external API is not complete

- **WHEN** the API key is missing and the user runs the checks
- **THEN** the **Claude Code model** row SHALL show fail, name the missing setting, and contain no secret value

#### Scenario: The transcripts folder is missing

- **WHEN** the transcripts folder in use does not exist
- **THEN** the **Claude Code folder** row SHALL show warn with the folder path

#### Scenario: Testing models

- **WHEN** the external API is complete, Pi uses a manual model, and the user runs the checks and tests models
- **THEN** the page SHALL show a **Claude Code model test** row and a **Pi model test** row
- **AND** the run SHALL send one test call to the external API

### Requirement: Diagnostics can be filtered by host

The capture diagnostics section SHALL offer a **Host** choice of All, OpenCode, Pi, and Claude Code. The server SHALL apply the choice to the outcomes, failure reasons, and recent attempts, so the recent attempts list holds up to its limit for the chosen host alone. The server SHALL refuse any other host value with `400`. The tables SHALL show each host by its display name. The retry queue counts SHALL stay per host.

#### Scenario: Only Claude Code

- **WHEN** the user chooses Claude Code
- **THEN** every table SHALL show only Claude Code attempts, with `Claude Code` in the host column

#### Scenario: An unknown host value

- **WHEN** a request asks for diagnostics with host `other`
- **THEN** the server SHALL answer `400`

### Requirement: The import model option names the saved external API and stays current

The import model choice SHALL show the saved external API as **Saved external API**, without the model name, for every history host, and SHALL still say when it is not ready. After any save on the Settings page, the Import section SHALL reload its model readiness.

#### Scenario: Choosing the import model for Claude Code

- **WHEN** the external API is ready and the user opens the import model choice for Claude Code
- **THEN** the option SHALL read **Saved external API** and SHALL NOT contain the model name

#### Scenario: Changing the external API model

- **WHEN** the user saves a new external API model on the page
- **THEN** the Import section SHALL show the new readiness without a page reload
