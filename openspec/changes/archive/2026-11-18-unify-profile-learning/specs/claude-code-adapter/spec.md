## ADDED Requirements

### Requirement: Claude Code shows the profile notice on a later hook

When a Claude Code learning pass saves the profile and `showUserProfileToasts` is `true`, the web app SHALL keep one pending profile notice line. The next `UserPromptSubmit` or `SessionStart` answer for a hook that can show user lines SHALL carry it as the user line, prefixed with "OMMS: ". The line SHALL NOT go into the model context. A newer pass SHALL replace a pending line that was not shown. A web app restart SHALL drop a pending line.

#### Scenario: The next prompt after learning

- **WHEN** a Claude Code pass learns 10 prompts and the user sends the next prompt
- **THEN** the user SHALL see "OMMS: User profile updated. Analysed 10 prompts and updated your profile"
- **AND** the line SHALL NOT appear in the context sent to the model

#### Scenario: Two passes before the next prompt

- **WHEN** two passes save before the user's next prompt
- **THEN** the user SHALL see one line, for the newer pass

#### Scenario: Notices off

- **WHEN** `showUserProfileToasts` is `false`
- **THEN** no profile notice line SHALL be shown

## MODIFIED Requirements

### Requirement: The web app adds user lines only for hooks that ask

The web app SHALL add a user line to its `SessionStart` or `UserPromptSubmit` answer only when the hook's request says that the hook can show user lines. The `SessionStart` answer SHALL carry the first-run notice and the capture setup line. Either answer SHALL carry a pending profile notice line. The retrieve request SHALL mark nothing as shown; only the hook's confirmation after it has written its answer SHALL. An older hook SHALL get today's answer, and SHALL NOT use up a line it cannot show.

#### Scenario: Old hook, new web app

- **WHEN** a hook that does not ask for user lines sends a `SessionStart` request
- **THEN** the answer SHALL hold no user line and the web app SHALL NOT mark the line as shown

#### Scenario: A subagent hook

- **WHEN** a `SubagentStart` hook sends a request while a profile notice line is pending
- **THEN** the answer SHALL hold no user line
- **AND** the line SHALL stay pending

#### Scenario: The prompt hook shows the profile line

- **WHEN** a `UserPromptSubmit` hook that can show user lines sends a request while a profile notice line is pending
- **THEN** the answer SHALL hold the line
- **AND** the line SHALL count as shown only after the hook confirms it
