# Spec Delta

## MODIFIED Requirements

### Requirement: The web app can be stopped and restarted from its page

The web app page SHALL show a power button in the sidebar footer when the caller may control the web app. The button SHALL be green while the web app answers. Selecting it SHALL open a confirmation dialog with Restart as the main action and Stop as the second action. The web app SHALL accept `POST /api/web/restart` and `POST /api/web/stop` only from a caller on a loopback address that sends the local API token. The web app SHALL answer `202` before it stops or restarts. `GET /api/web/status` SHALL report the web app's version, whether the caller may control it, and an opaque instance value. The instance value SHALL be the same for the life of one web app process and SHALL differ between processes. The page SHALL hide the power button when the caller may not control the web app.

A web app that stops SHALL exit with code `0`. A web app that restarts SHALL start a fresh copy of itself on the same port and then exit. When the login item started the web app, the restart SHALL go through the platform service manager. A restart SHALL NOT leave the port without an OMMS web app when the fresh copy cannot start: the old process SHALL start the copy before it stops serving, SHALL keep serving when the copy cannot start, and SHALL serve again when the copy exits or does not answer within 15 seconds after the old process stopped serving. A failed restart SHALL write one log record with a code. Each request SHALL write one log record with the outcome and SHALL NOT log the token.

After a stop, the page SHALL show that the web app stopped and the command to start it again. The dialog and the stopped page SHALL say that a stop lasts until the next OpenCode start, Pi start, Claude Code hook, `web install`, or login. After a restart, the page SHALL wait up to 30 seconds until a web app with a new instance value answers and then reload. When only the old instance answers at the end of the wait, the page SHALL say that the restart failed and that the web app still runs.

#### Scenario: Restarting the web app

- **WHEN** the user selects Restart in the dialog
- **THEN** the old process SHALL exit after it replies `202`
- **AND** a new process SHALL serve the same port
- **AND** the page SHALL reload when the new process answers

#### Scenario: The fresh copy cannot start

- **WHEN** the user selects Restart and the fresh copy fails to start
- **THEN** the old process SHALL keep serving the same port
- **AND** the web app SHALL write one log record with a failure code
- **AND** the page SHALL say that the restart failed and that the web app still runs

#### Scenario: The fresh copy exits before it serves

- **WHEN** the old process stopped serving and the fresh copy exits before it answers
- **THEN** the old process SHALL serve the same port again
- **AND** the page SHALL say that the restart failed and that the web app still runs

#### Scenario: The service manager cannot restart the login item

- **WHEN** the user selects Restart while the login item serves the page and the service manager command fails
- **THEN** the web app SHALL start a detached fresh copy instead
- **AND** when that copy cannot start either, the old process SHALL serve the same port again

#### Scenario: A host start during a restart

- **WHEN** a host starts while a restart hands the port from the old process to the fresh copy
- **THEN** the host SHALL wait for the web app and SHALL NOT start another one

#### Scenario: Restarting the login item

- **WHEN** the user selects Restart while the login item serves the page
- **THEN** the platform service manager SHALL start the login item again
- **AND** the page SHALL reload when the web app answers

#### Scenario: Stopping the web app

- **WHEN** the user selects Stop in the dialog
- **THEN** the process SHALL exit with code `0`
- **AND** the page SHALL show that the web app stopped, the command `om-memory-system web`, and that the next host start brings it back

#### Scenario: A host start after a stop

- **WHEN** the web app was stopped from the page and the user starts OpenCode, starts Pi, or sends a prompt in Claude Code
- **THEN** that host SHALL start the web app again under the shared start rule
- **AND** the host session SHALL NOT fail or wait for the web app

#### Scenario: A request without the token

- **WHEN** a stop or restart request arrives without the API token
- **THEN** the web app SHALL refuse it with `401` and SHALL keep serving

#### Scenario: A request from a non-loopback address

- **WHEN** a stop or restart request arrives from an address that is not loopback
- **THEN** the web app SHALL refuse it with `403` and SHALL keep serving
- **AND** the page SHALL NOT show the power button to that caller

#### Scenario: A repeated request while one runs

- **WHEN** a stop or restart request arrives while an earlier one is still running
- **THEN** the web app SHALL reply `202` and SHALL NOT start a second stop or restart

#### Scenario: Cancelling the dialog

- **WHEN** the user closes the confirmation dialog without choosing an action
- **THEN** the web app SHALL keep serving and SHALL send no request
