## RENAMED Requirements

- FROM: `### Requirement: OpenCode v2 restores session memories after compaction through v2 hooks`
- TO: `### Requirement: OpenCode v2 restores session memories after compaction or resume through v2 hooks`

## MODIFIED Requirements

### Requirement: OpenCode v2 restores session memories after compaction or resume through v2 hooks

Only when `compaction.enabled` is on, the plugin SHALL use OpenCode v2 session hooks to make a session's own captured memories available to its later requests after compaction, and after resume. A resumed session SHALL be the first prompt this process sees for a session whose history already holds an earlier user prompt. The plugin SHALL NOT send a prompt or synthetic message into the session to do so.

#### Scenario: A session is compacted

- **WHEN** OpenCode v2 compacts a session that has captured memories
- **THEN** subsequent model requests in that session SHALL include a bounded restored-session memory section, limited by `compaction.memoryLimit`
- **AND** no prompt, synthetic message, or queued turn SHALL be added to the session by the plugin

#### Scenario: A session is resumed

- **WHEN** the user opens an earlier OpenCode v2 session that has captured memories and sends a prompt
- **THEN** that prompt's model requests and the later ones SHALL include the restored-session memory section
- **AND** the restored section SHALL be loaded once for that resume

#### Scenario: A new session is not a resume

- **WHEN** the first prompt of a new session arrives
- **THEN** no restored-session memory section SHALL be added

#### Scenario: Compaction restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored-session memory section SHALL be added after compaction or resume

#### Scenario: Compaction event arrives on the event stream

- **WHEN** a v2 compaction event is observed on the public event stream
- **THEN** the plugin SHALL NOT also run the V1 post-compaction prompt-injection path for it
