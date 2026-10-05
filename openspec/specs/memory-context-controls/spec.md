# memory-context-controls Specification

## Purpose

Let users configure memory counts and context sizes from a file, and bound the memory text automatically added to agent requests without changing stored data.

## Requirements

### Requirement: Memory limits can be configured without the web UI

OMMS SHALL read these values from the global `~/.config/omms/omms.jsonc`, with these defaults and accepted ranges:

| Setting                      | Default | Unit               | Accepted values                           |
| ---------------------------- | ------- | ------------------ | ----------------------------------------- |
| `maxMemories`                | 10      | Results            | Positive safe integers                    |
| `chatMessage.maxMemories`    | 3       | Memories           | Positive safe integers                    |
| `autoCaptureMaxContextBytes` | 131072  | UTF-8 bytes        | Integers from 16384 to 16777216 inclusive |
| `userProfileMaxContextBytes` | 32768   | UTF-8 bytes        | Integers from 1024 to 16777216 inclusive  |
| `retrievalMaxTokens`         | 2000    | Approximate tokens | Integers from 256 to 65536 inclusive      |

`chatMessage.maxMemories` SHALL be a property of the `chatMessage` object, not a literal dotted key. The four existing defaults SHALL remain unchanged. A project file at `<project>/.opencode/omms.jsonc` SHALL retain its existing override rules, and SHALL also be able to override `retrievalMaxTokens`. Omitted values SHALL use their defaults. Present values of the wrong type, fractional values, and out-of-range values SHALL fail validation with the setting's name and its accepted values.

#### Scenario: Configuring from a terminal editor

- **WHEN** the user sets `maxMemories` to 6, `chatMessage.maxMemories` to 2, both byte limits to 65536, and `retrievalMaxTokens` to 3000 in the global file
- **THEN** OMMS SHALL use those limits without any web UI save
- **AND** no web server SHALL be required to configure Pi or OpenCode

#### Scenario: Existing file with no new budget

- **WHEN** an existing config omits `retrievalMaxTokens`
- **THEN** automatic injection SHALL use the new 2000 approximate-token budget
- **AND** the defaults for the four existing limits SHALL remain unchanged

#### Scenario: Invalid file value

- **WHEN** a file sets `retrievalMaxTokens` to 0, 255, 65537, 2000.5, `null`, or a string
- **THEN** validation SHALL refuse that value with the setting name and accepted range

#### Scenario: A project uses a smaller budget

- **WHEN** the global file sets `retrievalMaxTokens` to 3000 and the project file sets it to 1000
- **THEN** automatic memory injection in that project SHALL use 1000
- **AND** the project's override SHALL NOT change another project's global value

### Requirement: Automatic memory injection has one approximate size budget

Automatic memory context SHALL be limited by `retrievalMaxTokens` on OpenCode V1, OpenCode V2, Pi, and Claude Code. The limit SHALL cover prompt-based retrieval, recent-memory injection, and session-memory restoration after compaction or resume where those surfaces exist. It SHALL NOT add an injection surface to a host that lacks it.

The estimate SHALL be `ceil(UTF-8 byte length / 4)` for the final emitted memory text. It SHALL include profile text, explanatory text, headings, delimiters, omission markers, and any retrieval wrapper. It SHALL NOT count the host's own system prompt or the user's prompt. Documentation and the UI SHALL call this an approximate token count, which can differ from a provider's count.

The final emitted text SHALL fit the configured estimate. The budget SHALL change only what is injected. Stored memories, stored profiles, search matching, manual tool results, and CLI search output SHALL remain unchanged. The existing Claude Code added-context safety limit SHALL remain an additional limit.

#### Scenario: A few long memories

- **WHEN** matching memories and profile text exceed the configured budget
- **THEN** the emitted memory section SHALL fit that budget by the documented estimate
- **AND** the complete memory content SHALL remain available through manual search

#### Scenario: The same budget on Pi and OpenCode V2

- **WHEN** both hosts retrieve the same input with the same config
- **THEN** both SHALL use the same packing and size rules
- **AND** neither SHALL bypass the budget by adding another copy of the memory text

#### Scenario: Recent memory and restored session memory

- **WHEN** OpenCode V1 or Claude Code adds recent memories, or a supported host restores its session memories
- **THEN** the total automatically emitted memory text SHALL fit the same budget

#### Scenario: Claude Code has a stricter transport limit

- **WHEN** the configured budget permits more text than Claude Code's fixed added-context limit
- **THEN** Claude Code SHALL still respect its added-context limit
- **AND** its shared retrieval wrapper SHALL remain closed

#### Scenario: Manual search remains complete

- **WHEN** the user runs a manual search with a result that exceeds `retrievalMaxTokens`
- **THEN** the result's content SHALL NOT be shortened by the automatic injection budget
- **AND** the result count SHALL still follow `maxMemories` and the request's limit

### Requirement: Packing keeps useful content and complete delimiters

Packing SHALL preserve the incoming result order, which is relevance order for semantic search and the existing order for recent or restored memories. When an injected profile exists, its text SHALL use at most one quarter of the payload space left after fixed formatting. Remaining space SHALL be available to memories.

An oversized profile SHALL be shortened before it can consume the memory space. Memories SHALL be kept in order until the budget is reached. If the next memory exceeds the remaining space, that memory SHALL be shortened with a visible omission marker and no later memory SHALL be added. Omission markers SHALL fit within the budget. Formatting SHALL retain complete section delimiters and valid Unicode. When no useful content fits, the system SHALL emit no section.

#### Scenario: One oversized top-ranked memory

- **WHEN** the first result exceeds the space available for memories
- **THEN** its shortened content SHALL be injected with an omission marker
- **AND** lower-ranked results SHALL NOT displace it

#### Scenario: A long user profile

- **WHEN** the profile exceeds one quarter of the available payload
- **THEN** its injected copy SHALL be shortened within that allowance
- **AND** the memory results SHALL retain the remaining space

#### Scenario: Chinese and Arabic text

- **WHEN** a budget shortens mixed Chinese, Arabic, English, and emoji text
- **THEN** the text SHALL contain no broken Unicode characters
- **AND** every generated section delimiter SHALL remain complete

### Requirement: Memory limit changes take effect at the next relevant operation

A valid config change SHALL take effect without restarting the host or web app at the next relevant search, memory injection, capture, or OpenCode profile-learning operation. An operation already in progress SHALL finish with its original limits. An invalid hand edit during a live session SHALL retain the last valid settings and report a metadata-only error.

#### Scenario: Changing the budget while Pi runs

- **WHEN** the global budget changes from 2000 to 1000 while Pi runs
- **THEN** Pi's next retrieval SHALL use 1000 without restarting

#### Scenario: Invalid live edit

- **WHEN** the user changes a limit to a negative number during a session
- **THEN** the next operation SHALL keep the previous valid limits
- **AND** manual memory operations SHALL remain available

### Requirement: OpenCode profile input uses a true byte limit

`userProfileMaxContextBytes` SHALL limit the UTF-8 byte size of OpenCode's profile-learning input, including any truncation marker. It SHALL preserve valid Unicode and SHALL NOT change the stored prompts. The setting SHALL retain its current OpenCode coverage; the UI and documentation SHALL NOT describe it as a profile input limit for Pi or Claude Code.

#### Scenario: Multibyte profile input

- **WHEN** OpenCode builds profile input whose UTF-8 size exceeds 32768 bytes despite having fewer than 32768 JavaScript characters
- **THEN** the model's profile input SHALL fit within 32768 bytes, including the marker
- **AND** the stored prompts SHALL remain unchanged

#### Scenario: Input already fits

- **WHEN** the profile input fits the configured byte limit
- **THEN** the input SHALL remain unchanged
