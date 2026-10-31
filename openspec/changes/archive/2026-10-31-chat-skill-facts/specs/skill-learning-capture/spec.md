## MODIFIED Requirements

### Requirement: skills.db is separate and stays in the storage path

Recorded turns SHALL be kept in `skills.db` in the global storage path and never inside a project folder. Project memories, `user-prompts.db` and the user profile SHALL NOT read from or write to `skills.db`. The memory chat SHALL NOT write to `skills.db`. It MAY read skill counts and change history from it only while the global `skillLearning` setting is `true`, and it SHALL NOT read recorded turn text.

#### Scenario: Profile learning runs

- **WHEN** profile learning analyses prompts while recording is on
- **THEN** it SHALL read only `user-prompts.db` and SHALL NOT read `skills.db`

#### Scenario: Chat with recording off

- **WHEN** `skillLearning` is off and the user asks a question in the memory chat
- **THEN** the chat SHALL NOT open `skills.db`

#### Scenario: Chat with recording on

- **WHEN** `skillLearning` is on and the memory chat reads skill facts
- **THEN** `skills.db` SHALL be unchanged after the question
- **AND** no prompt, reply or tool-call text from it SHALL reach the chat
