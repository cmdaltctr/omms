# Spec Delta

## ADDED Requirements

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.287 or later, and SHALL show one status line under the prompt. Claude Code puts the plugin's name before the text, so the line reads `omms: <state>`. The state SHALL be `connected` when the web app answers its health route, `web app off` when it does not, and `not installed` when the plugin's launcher reports that it can run no OMMS copy: no local copy is new enough and `npx` fails. A launcher run that only runs out of time SHALL NOT show `not installed`. The line SHALL then show the health state alone, with no update, and the plugin SHALL try again at its next check. The plugin SHALL get its facts through its own launcher, so the line SHALL NOT depend on a global `om-memory-system` install. The line SHALL update while the session runs. The status line SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Web app running

- **WHEN** a Claude Code session starts and the web app answers its health route
- **THEN** the line under the prompt SHALL read `omms: connected`

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the line SHALL read `omms: web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: OMMS cannot run

- **WHEN** no local OMMS copy is at least the plugin's version and `npx` fails
- **THEN** the line SHALL read `omms: not installed`

#### Scenario: A slow first download

- **WHEN** no local copy is new enough, `npx` is still downloading when the launcher run times out, and the web app answers its health route
- **THEN** the line SHALL read `omms: connected` with no update
- **AND** the line SHALL NOT read `omms: not installed`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, the newest-copy record names a valid Pi copy at the plugin's version, and the web app answers its health route
- **THEN** the line SHALL read `omms: connected`

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS line SHALL show as a separate line

### Requirement: Claude Code tells the user about a newer OMMS release

At session start and every 6 hours, the plugin SHALL compare the version of the OMMS copy that its launcher runs with the `latest` version on the npm registry. When npm's version is newer and is not a prerelease, the status line SHALL add `· <version> available`. The plugin SHALL also show one toast per session that names `claude plugin update omms@omms` and `/reload-plugins`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** the launcher runs OMMS 4.3.3 and npm `latest` is 4.4.0
- **THEN** the line SHALL read `omms: connected · 4.4.0 available`
- **AND** one toast SHALL name `claude plugin update omms@omms`

#### Scenario: A host copy is already newer than the global install

- **WHEN** the global install is 4.3.0, the launcher runs an OpenCode 4.4.0 copy, and npm `latest` is 4.4.0
- **THEN** the line SHALL show no update

#### Scenario: Only a prerelease is newer

- **WHEN** npm `latest` is 4.4.0-next.1 and the launcher runs OMMS 4.3.3
- **THEN** the line SHALL show no update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

#### Scenario: npm cannot be reached

- **WHEN** the npm registry does not answer
- **THEN** the line SHALL show no update and no toast SHALL appear
