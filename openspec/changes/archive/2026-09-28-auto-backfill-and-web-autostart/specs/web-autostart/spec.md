# Spec Delta

## Purpose

Keep the OMMS web app available whenever the user is logged in, without a Pi or OpenCode session open, and give the terminal a command to start it or manage its login item.

## ADDED Requirements

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

The web app started by the login item or by `om-memory-system web` SHALL serve the same pages and API as the web app inside OpenCode, with the same port, bind address, origin rules, API token, and Basic Auth settings. When another OMMS process already serves the web app on the configured port, it SHALL follow the existing port ownership and takeover rules instead of starting a second server. Features that need a host, such as OpenCode's connected-model list, SHALL report that they are unavailable, with the existing reasons. It SHALL NOT run automatic backfill.

#### Scenario: Opening the web app with no session open

- **WHEN** the user logs in and opens the web app URL without starting Pi or OpenCode
- **THEN** the memories, profile, and Settings pages SHALL load

#### Scenario: OpenCode starts while the login web app runs

- **WHEN** the login web app owns the port and OpenCode starts
- **THEN** OpenCode SHALL use the running web app instead of starting a second one

### Requirement: The terminal can start and manage the web app

The package SHALL provide `om-memory-system web`, which starts the web app in the foreground until it is stopped, and `om-memory-system web install`, `web uninstall`, and `web status`. `install` SHALL set `webServerAutoStart` to `true` in the global config and install the login item. `uninstall` SHALL set it to `false` and remove the item. `status` SHALL report the setting, whether the item is installed, what it starts, and whether a web app answers on the configured port. `web` SHALL refuse to start, with the reason, when `webServerEnabled` is `false`.

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
