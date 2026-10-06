# web-update Specification

## Purpose

Tells a web page user when npm has a newer OMMS release, lists the update command for each host, and lets the user update the global install and restart the web app onto it with one action.

## Requirements

### Requirement: The web app checks npm for a newer release

The web app SHALL read the version of the npm `latest` tag for `om-memory-system` when it starts and then every 6 hours. A release SHALL count as an update only when it is newer than the running version and is not a prerelease. When `OMMS_DISABLE_UPDATE_CHECK` is `1`, the web app SHALL NOT contact npm and SHALL report no update. A failed check SHALL keep the result of the last successful check, SHALL write one log record with a code, and SHALL NOT affect the web app. `GET /api/web/status` SHALL report the newer version, or no version when there is no update.

#### Scenario: npm has a newer release

- **WHEN** the web app 4.9.0 runs and npm `latest` is 4.10.0
- **THEN** `GET /api/web/status` SHALL report 4.10.0 as the available update

#### Scenario: npm has the same release

- **WHEN** the web app 4.9.0 runs and npm `latest` is 4.9.0
- **THEN** `GET /api/web/status` SHALL report no update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK` is `1`
- **THEN** the web app SHALL NOT send a request to npm
- **AND** `GET /api/web/status` SHALL report no update

#### Scenario: npm cannot be reached

- **WHEN** the check fails because of a network error
- **THEN** the web app SHALL keep serving and SHALL keep the last known result

### Requirement: The page shows an update button when a release is available

When the status reports an update and the caller may control the web app, the sidebar footer SHALL show an update button. In the open desktop sidebar it SHALL sit in the footer row after the GitHub link and show the word for Update in the selected language. In the collapsed desktop sidebar it SHALL show an icon. On a narrow screen, where the footer row has no room, it SHALL show the word in its own row above the footer icons. The button SHALL have an accessible name that includes the new version. When there is no update, or the caller may not control the web app, the footer SHALL NOT show the button. Selecting the button SHALL open a dialog that shows the running version, the new version, and the update command for each host:

- Claude Code: `claude plugin update omms@omms`
- OpenCode: `opencode plugin update om-memory-system`
- Pi: `pi update npm:om-memory-system`
- Global command and web app: `npm i -g om-memory-system@latest && om-memory-system web install`

Each command SHALL have a copy action. The dialog SHALL say that OpenCode and Pi need their own update command and a restart.

#### Scenario: An update is available on this computer

- **WHEN** the status reports 4.10.0 and the caller is on a loopback address
- **THEN** the open desktop sidebar SHALL show a button labelled Update after the GitHub link
- **AND** the collapsed desktop sidebar SHALL show the button as an icon

#### Scenario: No update is available

- **WHEN** the status reports no update
- **THEN** the footer SHALL show only its current buttons

#### Scenario: A caller from another computer

- **WHEN** the status reports an update and the caller may not control the web app
- **THEN** the footer SHALL NOT show the update button

#### Scenario: Copying a command

- **WHEN** the user selects the copy action next to the OpenCode command
- **THEN** the clipboard SHALL hold `opencode plugin update om-memory-system`

### Requirement: The web app updates its global install and restarts onto it

The dialog SHALL offer an **Update web app** action. The web app SHALL accept `POST /api/web/update` only from a loopback caller that sends the local API token. It SHALL refuse a request without the token with `401`, a request from another address with `403`, and a request when there is no update with `409`. On success it SHALL answer `202` and then run `npm install -g om-memory-system@<new version>` with the npm that sits beside the Node.js that runs the web app. When that npm does not exist, the dialog SHALL disable the action and say why, and the route SHALL answer `409`. A second request while an update runs SHALL get `202` and SHALL NOT start another install.

When the install succeeds and the global install reports the new version, the web app SHALL restart through the OMMS launcher, so the restart runs the newest copy on the machine. When the install fails, times out after 5 minutes, or leaves the global install on another version, the web app SHALL keep serving on its current version. `GET /api/web/status` SHALL report the update state: idle, installing, restarting, or failed with a code. The page SHALL show progress while the state is installing or restarting, SHALL reload when a web app with a new instance answers, and SHALL show the failure code when the state is failed. Each update SHALL write log records with codes, versions, and durations. The log SHALL NOT hold npm output or the token.

#### Scenario: A successful update

- **WHEN** the web app 4.9.0 runs, npm `latest` is 4.10.0, and the user selects Update web app
- **THEN** the global install SHALL be 4.10.0
- **AND** a web app 4.10.0 SHALL serve the same port
- **AND** the page SHALL reload and the header SHALL show `v4.10.0`

#### Scenario: npm fails

- **WHEN** the install exits with an error
- **THEN** the web app 4.9.0 SHALL keep serving
- **AND** the dialog SHALL show a failure code

#### Scenario: The install does not finish

- **WHEN** the install runs longer than 5 minutes
- **THEN** the web app SHALL stop the install and SHALL keep serving
- **AND** the status SHALL report the failure code `timeout`

#### Scenario: No npm beside Node.js

- **WHEN** the web app runs under a runtime with no npm beside it
- **THEN** the dialog SHALL disable Update web app and SHALL say that the commands above still work

#### Scenario: A request without the token

- **WHEN** an update request arrives without the API token
- **THEN** the web app SHALL refuse it with `401` and SHALL NOT run npm

#### Scenario: A request from a non-loopback address

- **WHEN** an update request arrives from an address that is not loopback
- **THEN** the web app SHALL refuse it with `403` and SHALL NOT run npm

#### Scenario: A repeated request

- **WHEN** an update request arrives while an install runs
- **THEN** the web app SHALL reply `202` and SHALL NOT start a second install
