# web-power-control Specification

## Purpose

Let a user stop or restart the shared OMMS web app from its own page, without a terminal.

## Requirements

### Requirement: The web app can be stopped and restarted from its page

The web app page SHALL show a power button in the sidebar footer when the caller may control the web app. The button SHALL be green while the web app answers. Selecting it SHALL open a confirmation dialog with Restart as the main action and Stop as the second action. The web app SHALL accept `POST /api/web/restart` and `POST /api/web/stop` only from a caller on a loopback address that sends the local API token. The web app SHALL answer `202` before it stops or restarts. `GET /api/web/status` SHALL report the web app's version and whether the caller may control it. The page SHALL hide the power button when the caller may not control the web app.

A web app that stops SHALL exit with code `0`. A web app that restarts SHALL start a fresh copy of itself on the same port and then exit. When the login item started the web app, the restart SHALL go through the platform service manager. Each request SHALL write one log record with the outcome and SHALL NOT log the token.

After a stop, the page SHALL show that the web app stopped and the command to start it again. The dialog and the stopped page SHALL say that a stop lasts until the next OpenCode start, Pi start, Claude Code hook, `web install`, or login. After a restart, the page SHALL wait until the web app answers and then reload.

#### Scenario: Restarting the web app

- **WHEN** the user selects Restart in the dialog
- **THEN** the old process SHALL exit after it replies `202`
- **AND** a new process SHALL serve the same port
- **AND** the page SHALL reload when the new process answers

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

#### Scenario: Cancelling the dialog

- **WHEN** the user closes the confirmation dialog without choosing an action
- **THEN** the web app SHALL keep serving and SHALL send no request
