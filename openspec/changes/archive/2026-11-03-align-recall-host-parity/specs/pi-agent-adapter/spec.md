## ADDED Requirements

### Requirement: Pi restores session memories after compaction or resume

When `compaction.enabled` is on, the Pi adapter SHALL load the session's own Pi memories, up to `compaction.memoryLimit`, after `session_compact` and after a resume. A resume is a `session_start` with reason `resume`, or a first prompt in this process for a session whose branch holds earlier user prompts. Each later `before_agent_start` SHALL add the restored section in the shared compaction format until the next compaction or the session ends.

#### Scenario: Pi compacts a session

- **WHEN** Pi compacts a session that has captured memories and the user sends the next prompt
- **THEN** the returned system prompt SHALL hold the prompt's section and then the restored section

#### Scenario: Pi resumes a session

- **WHEN** the user runs `/resume` on a session that has captured memories and sends a prompt
- **THEN** the returned system prompt SHALL hold the restored section

#### Scenario: Pi keeps its own compaction summary

- **WHEN** Pi compacts a session
- **THEN** the adapter SHALL NOT replace or change Pi's compaction summary

#### Scenario: Restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored section SHALL be added

#### Scenario: A restored section within the budget

- **WHEN** the prompt's section and the restored section together exceed the retrieval budget
- **THEN** the restored section SHALL use only what the prompt's section left

#### Scenario: A restore row

- **WHEN** Pi runs in its terminal mode and a restored section with 4 memories is added
- **THEN** Pi SHALL draw `▸ ● memory [mode=restore, limit=4]` once for that restore, when `visibleRecall` is on

#### Scenario: A child session

- **WHEN** OMMS runs in a Pi child session with `OMPS_CHILD=1`
- **THEN** no restored section SHALL be added
