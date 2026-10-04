## MODIFIED Requirements

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.287 or later, and SHALL show one OMMS label in the prompt footer, at the right, after Claude Code's own mode labels. The label SHALL read `● omms: <state>`. The state SHALL be `connecting` from session start until the first health check answers, `connected` when the web app answers its health route, `web app off` when it does not, and `not installed` when the plugin's launcher reports that it can run no OMMS copy: no local copy is new enough and `npx` fails. The dot and state SHALL be green for `connected`, yellow for `connecting`, and red for `web app off` and `not installed`. The colours SHALL come from Claude Code's theme, so they follow the user's light or dark theme. The `connected` label SHALL NOT show a `⚠` sign or a yellow colour. The plugin SHALL NOT use Claude Code's plugin status row, which adds a `⚠` sign. A launcher run that only runs out of time SHALL NOT show `not installed`. The label SHALL then show the health state alone, with no update, and the plugin SHALL try again at its next check. The plugin SHALL get its facts through its own launcher, so the label SHALL NOT depend on a global `om-memory-system` install. The label SHALL update while the session runs. The label SHALL NOT hide or change Claude Code's own mode labels, and SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Session starts

- **WHEN** a Claude Code session starts and the first health check has not answered yet
- **THEN** the prompt footer SHALL show a yellow `● omms: connecting`

#### Scenario: Web app running

- **WHEN** a Claude Code session starts and the web app answers its health route
- **THEN** the prompt footer SHALL show a green `● omms: connected`
- **AND** the footer SHALL show no `⚠` sign and no yellow for OMMS
- **AND** no OMMS row SHALL show in Claude Code's plugin status row

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the prompt footer SHALL show a red `● omms: web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: Web app comes back during a session

- **WHEN** the label shows `web app off` and the web app starts answering its health route again
- **THEN** within 30 seconds the prompt footer SHALL show a green `● omms: connected`

#### Scenario: OMMS cannot run

- **WHEN** no local OMMS copy is at least the plugin's version and `npx` fails
- **THEN** the prompt footer SHALL show a red `● omms: not installed`

#### Scenario: A slow first download

- **WHEN** no local copy is new enough, `npx` is still downloading when the launcher run times out, and the web app answers its health route
- **THEN** the label SHALL read `● omms: connected` with no update
- **AND** the label SHALL NOT read `● omms: not installed`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, the newest-copy record names a valid Pi copy at the plugin's version, and the web app answers its health route
- **THEN** the label SHALL read `● omms: connected`

#### Scenario: Claude Code shows a mode label

- **WHEN** Claude Code shows its own mode label, for example `focus`, and the web app answers its health route
- **THEN** the prompt footer SHALL show the `focus` label and the `● omms: connected` label

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS label SHALL still show in the prompt footer

### Requirement: Claude Code tells the user about a newer OMMS release

At session start and every 6 hours, the plugin SHALL compare the version of the OMMS copy that its launcher runs with the `latest` version on the npm registry. When npm's version is newer and is not a prerelease, the OMMS label SHALL add a dim `· <version> available` after the state. The suffix SHALL NOT change the colour of the dot or the state. The plugin SHALL also show one toast per session that names `claude plugin update omms@omms` and `/reload-plugins`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** the launcher runs OMMS 4.3.3 and npm `latest` is 4.4.0
- **THEN** the label SHALL read `● omms: connected · 4.4.0 available`, with the dot and `connected` green
- **AND** one toast SHALL name `claude plugin update omms@omms`

#### Scenario: A host copy is already newer than the global install

- **WHEN** the global install is 4.3.0, the launcher runs an OpenCode 4.4.0 copy, and npm `latest` is 4.4.0
- **THEN** the label SHALL show no update

#### Scenario: Only a prerelease is newer

- **WHEN** npm `latest` is 4.4.0-next.1 and the launcher runs OMMS 4.3.3
- **THEN** the label SHALL show no update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

#### Scenario: npm cannot be reached

- **WHEN** the npm registry does not answer
- **THEN** the label SHALL show no update and no toast SHALL appear
