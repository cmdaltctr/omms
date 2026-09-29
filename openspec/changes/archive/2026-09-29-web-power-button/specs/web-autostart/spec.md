# Spec Delta

## ADDED Requirements

### Requirement: Every host start makes sure one shared web app runs

When `webServerEnabled` is `true`, each OpenCode start, each Pi start, and each Claude Code hook SHALL check the configured port for an OMMS web app. When one answers, the host SHALL use it and SHALL start nothing, whatever its version. When none answers, the host SHALL start one standalone web app as a detached process on the configured port, with the same runtime, bind address, and token rules as the login item and `om-memory-system web`. That web app SHALL keep running after the session ends. When several hosts start at the same time, at most one web app SHALL be started, and the other hosts SHALL wait for it and use it. A start that crashed SHALL NOT block a later start. When a process that is not OMMS holds the configured port, the host SHALL start nothing and SHALL log a code. The check SHALL NOT block or fail the host session. When `webServerEnabled` is `false`, no host SHALL start a web app. The start rule SHALL live in shared code, and each host SHALL call it without host-specific logic.

#### Scenario: Pi starts with no web app running

- **WHEN** Pi starts and no OMMS web app answers on the configured port
- **THEN** Pi SHALL start one standalone web app in the background
- **AND** the Pi session SHALL start without waiting for it

#### Scenario: A host starts while the web app runs

- **WHEN** OpenCode, Pi, or a Claude Code hook starts and an OMMS web app answers on the configured port
- **THEN** it SHALL use that web app and SHALL start nothing

#### Scenario: Two hosts start at the same time

- **WHEN** OpenCode and Pi start at the same time and no web app runs
- **THEN** exactly one standalone web app SHALL be started
- **AND** both hosts SHALL use it

#### Scenario: A crashed start

- **WHEN** a host crashed while it started the web app and left its start marker behind
- **THEN** the next host start SHALL still start the web app

#### Scenario: Another program holds the port

- **WHEN** a program that is not OMMS answers on the configured port and a host starts
- **THEN** the host SHALL start no web app and SHALL log a code

#### Scenario: The web app is turned off in the config

- **WHEN** `webServerEnabled` is `false` and a host starts
- **THEN** no web app SHALL be started

### Requirement: OpenCode background work does not depend on owning a web server

OpenCode SHALL run profile learning and the daily cleanup after each `session.idle` capture in every OpenCode session, whether or not any web app runs. It SHALL NOT require that the OpenCode process owns the web port. Cleanup SHALL keep its once-a-day limit in each process.

#### Scenario: OpenCode idles while the shared web app serves the page

- **WHEN** an OpenCode session goes idle and the shared standalone web app owns the port
- **THEN** OpenCode SHALL capture the session's prompts
- **AND** it SHALL run profile learning and, when a day has passed, the cleanup

#### Scenario: Two OpenCode windows are open

- **WHEN** two OpenCode sessions go idle
- **THEN** each SHALL run profile learning and the daily cleanup in its own process

## MODIFIED Requirements

### Requirement: The web app runs without a host session

The web app started by the login item, by `om-memory-system web`, or on demand by a Claude Code hook SHALL serve every page and API route with the configured port, bind address, origin rules, API token, and Basic Auth settings. It SHALL be the only kind of OMMS web app. OpenCode SHALL NOT run a web server inside its session, and SHALL use this web app. When another OMMS process already serves the web app on the configured port, it SHALL follow the existing port ownership and takeover rules instead of starting a second server. It SHALL serve the Claude Code hook endpoints for retrieval and capture. It SHALL list OpenCode's signed-in models on the Settings page by starting a private OpenCode server for the user. That server SHALL listen only on the loopback address, SHALL require a password that OMMS creates for that server, and SHALL stop after OMMS reads the list. When OMMS cannot get the list this way, the page SHALL show the reason and a next step. Features that need a host session's own models SHALL report that they are unavailable, SHALL say why, and SHALL name a next step: the external API, or the terminal and in-session import commands. These features are OpenCode model health checks and test calls, web history imports with an OpenCode signed-in model, a host backfill whose model is a host signed-in model, and Retry now for a host's queued turns. The Import section SHALL NOT offer an OpenCode signed-in model for a web import. It SHALL NOT start a backfill on its own. It SHALL run a host's backfill when the user starts or resumes it on the Settings page and that host's backfill model resolves to the external API. It SHALL run the Claude Code backfill when a Claude Code session start reaches it, under the auto-backfill rules.

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

#### Scenario: Importing from the page with OpenCode open

- **WHEN** an OpenCode session is open and the user starts a web import from the Settings page
- **THEN** the Import section SHALL offer only the external API as the model source
- **AND** it SHALL say that an import with an OpenCode signed-in model runs from the terminal or with `/import` in OpenCode

#### Scenario: Health check of an OpenCode model

- **WHEN** the user runs health checks and the OpenCode capture model is an OpenCode signed-in model
- **THEN** the OpenCode model check SHALL be shown as skipped with the reason, not as failed
