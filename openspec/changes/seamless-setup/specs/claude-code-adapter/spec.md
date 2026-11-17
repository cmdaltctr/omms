## MODIFIED Requirements

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.295 or later, and SHALL show one OMMS label in the prompt footer, at the right, after Claude Code's own mode labels. The label SHALL read `omms: <glyph>`. The state SHALL be `connecting` from session start until the first health check answers, `connected` when the web app answers its health route, `capture off` when the web app answers its health route and reports that Claude Code capture is on but the external API is not ready, `web app off` when it does not answer, and `not installed` when the plugin's launcher reports that it can run no OMMS copy: no local copy is new enough and `npx` fails. The glyph SHALL be `⧖` for `connecting`, and `✔` for `connected`. For `capture off` the glyph SHALL be `✔`, followed by the words `capture off`. For `web app off` and `not installed` the glyph SHALL be `✘`, followed by the state's words. Each glyph SHALL be a single-column text symbol, not a colour emoji, and the label SHALL show no `●` dot. The glyph and any state words SHALL be green for `connected`, yellow for `connecting`, amber (the theme's warning colour) for `capture off`, and red for `web app off` and `not installed`. The colours SHALL come from Claude Code's theme, so they follow the user's light or dark theme. The `connected` label SHALL NOT show a `⚠` sign or a yellow colour. The plugin SHALL NOT use Claude Code's plugin status row, which adds a `⚠` sign. A health answer without the capture state, from an older web app, SHALL count as `connected`. A launcher run that only runs out of time SHALL NOT show `not installed`. The label SHALL then show the health state alone, with no update, and the plugin SHALL try again at its next check. The plugin SHALL get its facts through its own launcher, so the label SHALL NOT depend on a global `om-memory-system` install. The label SHALL update while the session runs. The label SHALL NOT hide or change Claude Code's own mode labels, and SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Session starts

- **WHEN** a Claude Code session starts and the first health check has not answered yet
- **THEN** the prompt footer SHALL show a yellow `omms: ⧖`

#### Scenario: Web app running

- **WHEN** a Claude Code session starts, the web app answers its health route, and Claude Code capture is ready
- **THEN** the prompt footer SHALL show a green `omms: ✔`
- **AND** the footer SHALL show no `⚠` sign and no yellow for OMMS
- **AND** no OMMS row SHALL show in Claude Code's plugin status row

#### Scenario: Capture needs the external API

- **WHEN** the web app answers its health route, `autoCaptureEnabled` is on, and the external API has no key
- **THEN** the prompt footer SHALL show an amber `omms: ✔ capture off`

#### Scenario: External API set during a session

- **WHEN** the label shows `capture off` and the user saves a complete external API on the Settings page
- **THEN** within 30 seconds the prompt footer SHALL show a green `omms: ✔`

#### Scenario: Capture turned off on purpose

- **WHEN** `autoCaptureEnabled` is `false` and the web app answers its health route
- **THEN** the prompt footer SHALL show a green `omms: ✔`

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the prompt footer SHALL show a red `omms: ✘ web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: Web app comes back during a session

- **WHEN** the label shows `web app off` and the web app starts answering its health route again
- **THEN** within 30 seconds the prompt footer SHALL show a green `omms: ✔`

#### Scenario: OMMS cannot run

- **WHEN** no local OMMS copy is at least the plugin's version and `npx` fails
- **THEN** the prompt footer SHALL show a red `omms: ✘ not installed`

#### Scenario: A slow first download

- **WHEN** no local copy is new enough, `npx` is still downloading when the launcher run times out, and the web app answers its health route
- **THEN** the label SHALL read `omms: ✔` with no update
- **AND** the label SHALL NOT read `omms: ✘ not installed`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, the newest-copy record names a valid Pi copy at the plugin's version, and the web app answers its health route
- **THEN** the label SHALL read `omms: ✔`

#### Scenario: Claude Code shows a mode label

- **WHEN** Claude Code shows its own mode label, for example `focus`, and the web app answers its health route
- **THEN** the prompt footer SHALL show the `focus` label and the `omms: ✔` label

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS label SHALL still show in the prompt footer

## ADDED Requirements

### Requirement: Claude Code says once that capture needs setup

When `autoCaptureEnabled` is on and the external API is not ready, the first `SessionStart` hook SHALL show the user one short line that says capture is off, names the missing settings in plain words, and gives the Settings page link to the External API card. The line SHALL be shown to the user and SHALL NOT be added to the model's context. The hook SHALL still print exactly one JSON result on standard output and send logs to standard error.

#### Scenario: First session without a key

- **WHEN** a Claude Code session starts, capture is on, and `memoryApiKey` is not set
- **THEN** the user SHALL see one line that says capture is off until the external API is set, with the Settings link
- **AND** the line SHALL NOT appear in the context sent to the model

### Requirement: The capture setup line is shown once per loss of setup

The capture setup line SHALL be shown once per computer while the external API stays not ready. When a `SessionStart` finds the external API ready, the record SHALL be cleared, so a later loss of the setup shows the line once again. The status label SHALL keep showing `capture off` in the sessions that do not show the line.

#### Scenario: Second session

- **WHEN** a second Claude Code session starts and the external API is still not set
- **THEN** the hook SHALL NOT show the line again
- **AND** the status label SHALL still show `omms: ✔ capture off`

#### Scenario: Key removed later

- **WHEN** the external API was ready at one `SessionStart` and the key is removed before the next
- **THEN** the next `SessionStart` SHALL show the line once

### Requirement: A user line counts as shown only after the hook confirms it

The capture setup line and the Claude Code first-run notice SHALL count as shown only after the hook has written its answer and then confirmed the lines to the web app. A line whose answer was lost SHALL show again at the next `SessionStart`. A failed confirmation SHALL NOT change the hook's answer or its exit code.

#### Scenario: First answer lost

- **WHEN** the hook's first `SessionStart` request times out before the answer arrives
- **THEN** the web app SHALL NOT record the lines as shown
- **AND** the next `SessionStart` SHALL show them

### Requirement: The web app adds user lines only for hooks that ask

The web app SHALL add a user line to its `SessionStart` answer only when the hook's request says that the hook can show user lines. The retrieve request SHALL mark nothing as shown; only the hook's confirmation after it has written its answer SHALL. An older hook SHALL get today's answer, and SHALL NOT use up a line it cannot show.

#### Scenario: Old hook, new web app

- **WHEN** a hook that does not ask for user lines sends a `SessionStart` request
- **THEN** the answer SHALL hold no user line and the web app SHALL NOT mark the line as shown

### Requirement: The Claude Code hook reports a busy port as its own code

When the hook finds that a program that is not OMMS holds the configured web app port, it SHALL log the code `port-busy`, not `server-unreachable`, and SHALL start nothing. `server-unreachable` SHALL mean that no web app answered and no Node or Bun runtime was found to start one.

#### Scenario: Another program holds port 4747

- **WHEN** a program that is not OMMS answers on port 4747 and a hook runs
- **THEN** the hook log line SHALL carry the code `port-busy`
- **AND** the hook SHALL start no web app

#### Scenario: No runtime

- **WHEN** nothing answers on the port and no Node or Bun runtime is found
- **THEN** the hook log line SHALL carry the code `server-unreachable`

### Requirement: The hook troubleshooting table gives the right fix

The Claude Code guide's troubleshooting table SHALL give the fix for each hook code: for `port-busy`, find and stop the program on the port or set `webServerPort` to a free port; for `server-unreachable`, install Node 22.14 or later. The table SHALL give each terminal command in a form that works without a global install (`npx om-memory-system@latest …`).

#### Scenario: Reader looks up port-busy

- **WHEN** a user finds `port-busy` in the log and opens the troubleshooting table
- **THEN** the row SHALL tell them to free the port or change `webServerPort`, and SHALL NOT tell them to install Node
