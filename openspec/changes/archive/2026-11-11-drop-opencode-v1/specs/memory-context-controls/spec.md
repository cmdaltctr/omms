## MODIFIED Requirements

### Requirement: Memory limits can be configured without the web UI

OMMS SHALL read these values from the global `~/.config/omms/omms.jsonc`, with these defaults and accepted ranges:

| Setting                      | Default                                        | Unit               | Accepted values                           |
| ---------------------------- | ---------------------------------------------- | ------------------ | ----------------------------------------- |
| `maxMemories`                | 10                                             | Results            | Positive safe integers                    |
| `autoCaptureMaxContextBytes` | 131072                                         | UTF-8 bytes        | Integers from 16384 to 16777216 inclusive |
| `userProfileMaxContextBytes` | 32768                                          | UTF-8 bytes        | Integers from 1024 to 16777216 inclusive  |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | Integers from 256 to 65536 inclusive      |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Numbers from 0 to 1 inclusive             |

The integer defaults SHALL remain unchanged. `similarityThreshold` SHALL default to 0.5 when the active embedding model is `qwen3-embedding:0.6b` (or one of its listed aliases) and to 0.6 for every other embedder, including the built-in model. A value present in the file SHALL always be used instead of the default. The default table SHALL be a small list in code, so a measured embedder can be added by one line. A memory is returned by search only when its similarity score is at least this value. A project file at `<project>/.opencode/omms.jsonc` SHALL retain its existing override rules, and SHALL also be able to override `retrievalMaxTokens`. Omitted values SHALL use their defaults. Present values of the wrong type, fractional values for the integer settings, and out-of-range values SHALL fail validation with the setting's name and its accepted values.

#### Scenario: Configuring from a terminal editor

- **WHEN** the user sets `maxMemories` to 6, both byte limits to 65536, and `retrievalMaxTokens` to 3000 in the global file
- **THEN** OMMS SHALL use those limits without any web UI save
- **AND** no web server SHALL be required to configure Pi or OpenCode

#### Scenario: Existing file with no new budget

- **WHEN** an existing config omits `retrievalMaxTokens`
- **THEN** automatic injection SHALL use the new 2000 approximate-token budget
- **AND** the defaults for the other limits SHALL remain unchanged

#### Scenario: Invalid file value

- **WHEN** a file sets `retrievalMaxTokens` to 0, 255, 65537, 2000.5, `null`, or a string
- **THEN** validation SHALL refuse that value with the setting name and accepted range

#### Scenario: A project uses a smaller budget

- **WHEN** the global file sets `retrievalMaxTokens` to 3000 and the project file sets it to 1000
- **THEN** automatic memory injection in that project SHALL use 1000
- **AND** the project's override SHALL NOT change another project's global value

#### Scenario: File that omits the threshold, measured embedder

- **WHEN** a config does not set `similarityThreshold` and the embedding model is `qwen3-embedding:0.6b`
- **THEN** search SHALL use 0.5

#### Scenario: File that omits the threshold, other embedder

- **WHEN** a config does not set `similarityThreshold` and the embedding model is `Xenova/nomic-embed-text-v1`
- **THEN** search SHALL use 0.6

#### Scenario: The embedder changes

- **WHEN** a config has no `similarityThreshold` and the user changes the embedder from `qwen3-embedding:0.6b` to the built-in model
- **THEN** the next search SHALL use 0.6

#### Scenario: New file

- **WHEN** OMMS writes the config template to a new file
- **THEN** the template SHALL NOT contain an active `similarityThreshold` line
- **AND** it MAY contain a comment that names the setting and says the default follows the embedder

#### Scenario: Existing file that sets a value

- **WHEN** a config sets `similarityThreshold` to 0.6 and the embedder is `qwen3-embedding:0.6b`
- **THEN** search SHALL use 0.6
- **AND** OMMS SHALL NOT rewrite the file

#### Scenario: Decimal threshold

- **WHEN** the user sets `similarityThreshold` to 0.45
- **THEN** validation SHALL accept it

#### Scenario: Invalid threshold

- **WHEN** a file sets `similarityThreshold` to -0.1, 1.1, `null`, or a string
- **THEN** validation SHALL refuse that value with the setting name and accepted range

### Requirement: Automatic memory injection has one approximate size budget

Automatic memory context SHALL be limited by `retrievalMaxTokens` on OpenCode V2, Pi, and Claude Code. The limit SHALL cover prompt-based retrieval, the opening section, subagent memory, and session-memory restoration after compaction or resume where those surfaces exist. It SHALL NOT add an injection surface to a host that lacks it.

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

- **WHEN** a supported host restores its session memories
- **THEN** the total automatically emitted memory text SHALL fit the same budget
- **AND** no host SHALL add a separate recent-memory list

#### Scenario: Claude Code has a stricter transport limit

- **WHEN** the configured budget permits more text than Claude Code's fixed added-context limit
- **THEN** Claude Code SHALL still respect its added-context limit
- **AND** its shared retrieval wrapper SHALL remain closed

#### Scenario: Manual search remains complete

- **WHEN** the user runs a manual search with a result that exceeds `retrievalMaxTokens`
- **THEN** the result's content SHALL NOT be shortened by the automatic injection budget
- **AND** the result count SHALL still follow `maxMemories` and the request's limit

## ADDED Requirements

### Requirement: Removed chatMessage keys are ignored

OMMS SHALL ignore `chatMessage.maxMemories`, `chatMessage.maxAgeDays` and `chatMessage.injectOn` in the global and project config files. It SHALL NOT validate them, fail on them, log them or rewrite the file to remove them. `chatMessage.enabled` and `chatMessage.excludeCurrentSession` SHALL keep their meaning, and a project `chatMessage` object SHALL still replace the global one as a whole.

#### Scenario: An old file keeps the removed keys

- **WHEN** the global file has `"chatMessage": { "enabled": true, "maxMemories": 3, "injectOn": "first", "maxAgeDays": 30 }`
- **THEN** OMMS SHALL load the config with no error and no warning
- **AND** the file SHALL remain unchanged

#### Scenario: A removed key has a value that was invalid before

- **WHEN** the global file sets `chatMessage.maxMemories` to 0
- **THEN** OMMS SHALL load the config with no validation error

#### Scenario: A project object replaces the global object

- **WHEN** the global file sets `"chatMessage": { "enabled": false, "maxMemories": 5 }` and the project file sets `"chatMessage": { "enabled": true }`
- **THEN** per-prompt retrieval in that project SHALL be on
- **AND** `excludeCurrentSession` SHALL use its default

### Requirement: An untagged memory is scored by its content alone

Search SHALL score a memory that has no tags by its content similarity alone, before the `similarityThreshold` check. A memory with tags SHALL keep the score of 60% content similarity and 40% tag similarity.

#### Scenario: A short query finds a new untagged memory

- **WHEN** a memory with no tags is added and a search query matches its content at 0.83
- **THEN** the memory's score SHALL be 0.83, not 0.6 of it
- **AND** search SHALL return it when the threshold is 0.5

#### Scenario: A tagged memory keeps the blend

- **WHEN** a memory has tags that do not match the query and its content matches fully
- **THEN** its score SHALL be 0.6
