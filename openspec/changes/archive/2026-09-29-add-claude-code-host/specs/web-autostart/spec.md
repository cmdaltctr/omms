# Spec Delta

## MODIFIED Requirements

### Requirement: The web app runs without a host session

The web app started by the login item, by `om-memory-system web`, or on demand by a Claude Code hook SHALL serve the same pages and API as the web app inside OpenCode, with the same port, bind address, origin rules, API token, and Basic Auth settings. When another OMMS process already serves the web app on the configured port, it SHALL follow the existing port ownership and takeover rules instead of starting a second server. It SHALL serve the Claude Code hook endpoints for retrieval and capture. It SHALL list OpenCode's signed-in models on the Settings page by starting a private OpenCode server for the user. That server SHALL listen only on the loopback address, SHALL require a password that OMMS creates for that server, and SHALL stop after OMMS reads the list. When OMMS cannot get the list this way, the page SHALL show the reason and a next step. Other features that need a host, such as OpenCode health checks, test calls, and history imports, SHALL report that they are unavailable, with the existing reasons. It SHALL NOT start a backfill on its own. It SHALL run a host's backfill when the user starts or resumes it on the Settings page and that host's backfill model resolves to the external API. It SHALL run the Claude Code backfill when a Claude Code session start reaches it, under the auto-backfill rules.

#### Scenario: Opening the web app with no session open

- **WHEN** the user logs in and opens the web app URL without starting Pi or OpenCode
- **THEN** the memories, profile, and Settings pages SHALL load

#### Scenario: OpenCode starts while the login web app runs

- **WHEN** the login web app owns the port and OpenCode starts
- **THEN** OpenCode SHALL use the running web app instead of starting a second one

#### Scenario: The login web app does not backfill by itself

- **WHEN** the login web app starts with pending history and `autoBackfill` on
- **THEN** no backfill SHALL start until the user clicks Run now or Resume

#### Scenario: Listing OpenCode models with no session open

- **WHEN** OpenCode is installed with provider `zai-coding-plan` signed in, no OpenCode session is open, and the user opens Settings in the login web app
- **THEN** the OpenCode model card SHALL list `zai-coding-plan` models, such as `glm-5.3`
- **AND** no OpenCode server started for the list SHALL still run after the list is read

#### Scenario: Reloading Settings soon after a list was read

- **WHEN** the login web app read OpenCode's model list less than five minutes ago and the user reloads Settings
- **THEN** the page SHALL show the same list without starting another OpenCode server

#### Scenario: Provider keys stay out of the page and the log

- **WHEN** the private OpenCode server's model list includes a provider API key
- **THEN** the key SHALL NOT appear in the Settings response, the OMMS log, or any error message

#### Scenario: A Claude Code hook starts the web app

- **WHEN** no web app is running and a Claude Code `SessionStart` hook runs
- **THEN** the hook SHALL start the web app with the same runtime and settings as `om-memory-system web`
- **AND** the web app SHALL keep running after the Claude Code session ends

#### Scenario: A Claude Code session start reaches the login web app

- **WHEN** the login web app is running with `autoBackfill` on and a Claude Code `SessionStart` hook reaches it
- **THEN** the web app SHALL run the Claude Code backfill under the auto-backfill rules
- **AND** it SHALL NOT start the Pi or OpenCode backfill
