# Spec Delta

## ADDED Requirements

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.287 or later, and SHALL show one status line under the prompt. Claude Code puts the plugin's name before the text, so the line reads `omms: <state>`. The state SHALL be `connected` when the web app answers its health route, `web app off` when it does not, and `not installed` when the `om-memory-system` command cannot run. The line SHALL update while the session runs. The status line SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Web app running

- **WHEN** a Claude Code session starts and the web app answers its health route
- **THEN** the line under the prompt SHALL read `omms: connected`

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the line SHALL read `omms: web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: Command missing

- **WHEN** the `om-memory-system` command is not on the `PATH`
- **THEN** the line SHALL read `omms: not installed`

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS line SHALL show as a separate line

### Requirement: Claude Code tells the user about a newer OMMS release

At session start and every 6 hours, the plugin SHALL compare the installed `om-memory-system` command's version with the `latest` version on the npm registry. When npm's version is newer and is not a prerelease, the status line SHALL add `· <version> available`. The plugin SHALL also show one toast per session that names `npm i -g om-memory-system@latest`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** the installed command is 4.3.3 and npm `latest` is 4.4.0
- **THEN** the line SHALL read `omms: connected · 4.4.0 available`
- **AND** one toast SHALL name `npm i -g om-memory-system@latest`

#### Scenario: Only a prerelease is newer

- **WHEN** npm `latest` is 4.4.0-next.1 and the installed command is 4.3.3
- **THEN** the line SHALL show no update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

#### Scenario: npm cannot be reached

- **WHEN** the npm registry does not answer
- **THEN** the line SHALL show no update and no toast SHALL appear
