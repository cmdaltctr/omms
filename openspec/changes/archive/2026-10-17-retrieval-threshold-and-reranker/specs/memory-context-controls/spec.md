## MODIFIED Requirements

### Requirement: Memory limits can be configured without the web UI

OMMS SHALL read these values from the global `~/.config/omms/omms.jsonc`, with these defaults and accepted ranges:

| Setting                      | Default                                        | Unit               | Accepted values                           |
| ---------------------------- | ---------------------------------------------- | ------------------ | ----------------------------------------- |
| `maxMemories`                | 10                                             | Results            | Positive safe integers                    |
| `chatMessage.maxMemories`    | 3                                              | Memories           | Positive safe integers                    |
| `autoCaptureMaxContextBytes` | 131072                                         | UTF-8 bytes        | Integers from 16384 to 16777216 inclusive |
| `userProfileMaxContextBytes` | 32768                                          | UTF-8 bytes        | Integers from 1024 to 16777216 inclusive  |
| `retrievalMaxTokens`         | 2000                                           | Approximate tokens | Integers from 256 to 65536 inclusive      |
| `similarityThreshold`        | 0.5 with `qwen3-embedding:0.6b`, otherwise 0.6 | Similarity score   | Numbers from 0 to 1 inclusive             |

`chatMessage.maxMemories` SHALL be a property of the `chatMessage` object, not a literal dotted key. The four integer defaults other than `similarityThreshold` SHALL remain unchanged. `similarityThreshold` SHALL default to 0.5 when the active embedding model is `qwen3-embedding:0.6b` (or one of its listed aliases) and to 0.6 for every other embedder, including the built-in model. A value present in the file SHALL always be used instead of the default. The default table SHALL be a small list in code, so a measured embedder can be added by one line. A memory is returned by search only when its similarity score is at least this value. A project file at `<project>/.opencode/omms.jsonc` SHALL retain its existing override rules, and SHALL also be able to override `retrievalMaxTokens`. Omitted values SHALL use their defaults. Present values of the wrong type, fractional values for the integer settings, and out-of-range values SHALL fail validation with the setting's name and its accepted values.

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
