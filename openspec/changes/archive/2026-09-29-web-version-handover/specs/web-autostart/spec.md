# Spec Delta

## MODIFIED Requirements

### Requirement: The terminal can start and manage the web app

The package SHALL provide `om-memory-system web`, which starts the web app in the foreground until it is stopped, and `om-memory-system web install`, `web uninstall`, and `web status`. `install` SHALL set `webServerAutoStart` to `true` in the global config and install the login item. `uninstall` SHALL set it to `false` and remove the item. `status` SHALL report the setting, whether the item is installed, what it starts, and whether a web app answers on the configured port. `web` SHALL refuse to start, with the reason, when `webServerEnabled` is `false`. `om-memory-system --version` SHALL print the package version and exit with code `0`. Before `install` starts the login item, it SHALL read the version of the OMMS web app on the configured port. When that web app is an older OMMS, `install` SHALL ask it to step aside, SHALL wait until the port is free, and SHALL then start the login item. When the older web app cannot step aside, `install` SHALL name its version and SHALL say how to stop it. When the web app is the same or a newer version, `install` SHALL leave it running and SHALL say which version serves the port. Only a caller on the loopback address with the local API token SHALL be able to make a web app step aside. A standalone web app that steps aside SHALL exit. A web app inside an OpenCode session that steps aside SHALL stop serving, SHALL keep the session running, and SHALL NOT take the port back for 60 seconds.

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

#### Scenario: Installing over an older web app

- **WHEN** OMMS 3.7.0 runs `om-memory-system web install` and a standalone OMMS 3.6.0 web app with the step-aside route holds the configured port
- **THEN** the 3.6.0 web app SHALL exit
- **AND** the 3.7.0 login item SHALL serve the port
- **AND** the command SHALL print that version 3.7.0 serves the port

#### Scenario: Installing over an older web app inside a session

- **WHEN** `web install` asks an older web app inside an OpenCode session to step aside
- **THEN** that web app SHALL stop serving and the OpenCode session SHALL keep running
- **AND** it SHALL NOT take the port back for 60 seconds

#### Scenario: Installing over a web app without the step-aside route

- **WHEN** `web install` finds OMMS 3.5.0 on the configured port and that version has no step-aside route
- **THEN** the command SHALL say that OMMS 3.5.0 holds the port
- **AND** it SHALL tell the user to stop that web app and run `web install` again

#### Scenario: Installing over the same version

- **WHEN** `web install` finds a web app of the same version on the configured port
- **THEN** that web app SHALL keep running
- **AND** the command SHALL print that this version serves the port

#### Scenario: A step-aside request without the token

- **WHEN** a request to step aside comes without the local API token, or from an address other than loopback
- **THEN** the web app SHALL refuse it and SHALL keep serving
