# web-autostart Specification

## Purpose

Keep the OMMS web app available whenever the user is logged in, without a Pi or OpenCode session open, and give the terminal a command to start it or manage its login item.

## Requirements

### Requirement: The web app starts at login by default

When `webServerAutoStart` is `true`, which is the default, and `webServerEnabled` is `true`, OMMS SHALL keep a login item that starts the web app when the user logs in: a LaunchAgent on macOS, a systemd user service on Linux, and a Startup-folder entry on Windows. Each Pi or OpenCode start SHALL check the item and install it, or rewrite it when it points at an old runtime or package path. When either setting is `false`, the next check SHALL remove the item. OMMS SHALL only create, rewrite, or remove the item it owns, identified by a fixed name, and SHALL NOT touch other login items. Both settings SHALL be read from the global config only. A failure to install or remove the item SHALL be logged and SHALL NOT affect the session.

#### Scenario: First start after the upgrade on macOS

- **WHEN** OpenCode starts with `webServerAutoStart` unset and no OMMS LaunchAgent exists
- **THEN** OMMS SHALL install its LaunchAgent
- **AND** the web app SHALL start at the next login

#### Scenario: Turning the setting off

- **WHEN** the user sets `webServerAutoStart` to `false` and a host starts
- **THEN** OMMS SHALL remove its login item and leave other login items unchanged

#### Scenario: The package moved after an update

- **WHEN** the installed OMMS package path changes and a host starts
- **THEN** the login item SHALL be rewritten to start the new path

#### Scenario: One project's web preference cannot disable the shared server

- **WHEN** the global `webServerEnabled` setting is `true` and project A sets it to `false`
- **THEN** the project setting SHALL be ignored
- **AND** project B SHALL still be able to use the shared web app

#### Scenario: An unsupported platform

- **WHEN** the platform has no supported login-item mechanism
- **THEN** OMMS SHALL skip the item and report the platform as unsupported in its status

### Requirement: The web app runs without a host session

The web app started by the login item or by `om-memory-system web` SHALL serve the same pages and API as the web app inside OpenCode, with the same port, bind address, origin rules, API token, and Basic Auth settings. When another OMMS process already serves the web app on the configured port, it SHALL follow the existing port ownership and takeover rules instead of starting a second server. It SHALL list OpenCode's signed-in models on the Settings page by starting a private OpenCode server for the user. That server SHALL listen only on the loopback address, SHALL require a password that OMMS creates for that server, and SHALL stop after OMMS reads the list. When OMMS cannot get the list this way, the page SHALL show the reason and a next step. Other features that need a host, such as OpenCode health checks, test calls, and history imports, SHALL report that they are unavailable, with the existing reasons. It SHALL NOT start a backfill on its own. It SHALL run a host's backfill when the user starts or resumes it on the Settings page and that host's backfill model resolves to the external API.

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

### Requirement: The terminal can start and manage the web app

The package SHALL provide `om-memory-system web`, which starts the web app in the foreground until it is stopped, and `om-memory-system web install`, `web uninstall`, and `web status`. `install` SHALL set `webServerAutoStart` to `true` in the global config and install the login item. `uninstall` SHALL set it to `false` and remove the item. `status` SHALL report the setting, whether the item is installed, what it starts, and whether a web app answers on the configured port. `web` SHALL refuse to start, with the reason, when `webServerEnabled` is `false`. `om-memory-system --version` SHALL print the package version and exit with code `0`.

#### Scenario: Starting the web app by hand

- **WHEN** the user runs `om-memory-system web`
- **THEN** the web app SHALL start and print its URL

#### Scenario: Removing the login item from the terminal

- **WHEN** the user runs `om-memory-system web uninstall`
- **THEN** the login item SHALL be removed and `webServerAutoStart` SHALL be `false` in the global config
- **AND** a later host start SHALL NOT install the item again

#### Scenario: The web server is disabled

- **WHEN** `webServerEnabled` is `false` and the user runs `om-memory-system web`
- **THEN** the command SHALL exit with a message that the web server is disabled

#### Scenario: Printing the version

- **WHEN** the user runs `om-memory-system --version`
- **THEN** the command SHALL print the installed package version and exit with code `0`

### Requirement: The web app reports the global command's version

The Settings page's **Web app** section SHALL show the running OMMS version and the version of the `om-memory-system` command found on the web app's `PATH`, or that the command is not installed globally. When the two versions differ, the section SHALL warn about it and show the command that upgrades the global install. It SHALL say that a global install is optional but recommended, because it lets the login item and the terminal commands run without `npx`.

#### Scenario: The global command is older

- **WHEN** OMMS 3.4.0 runs and the global `om-memory-system --version` prints `3.3.1`
- **THEN** the section SHALL warn that the versions differ and show the upgrade command

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the web app's `PATH`
- **THEN** the section SHALL say that it is not installed globally and show the install command
