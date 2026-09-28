## ADDED Requirements

### Requirement: The web app reports the global command's version

The Settings page's **Web app** section SHALL show the running OMMS version and the version of the `om-memory-system` command found on the web app's `PATH`, or that the command is not installed globally. When the two versions differ, the section SHALL warn about it and show the command that upgrades the global install. It SHALL say that a global install is optional but recommended, because it lets the login item and the terminal commands run without `npx`.

#### Scenario: The global command is older

- **WHEN** OMMS 3.4.0 runs and the global `om-memory-system --version` prints `3.3.1`
- **THEN** the section SHALL warn that the versions differ and show the upgrade command

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the web app's `PATH`
- **THEN** the section SHALL say that it is not installed globally and show the install command

## MODIFIED Requirements

### Requirement: The web app runs without a host session

The web app started by the login item or by `om-memory-system web` SHALL serve the same pages and API as the web app inside OpenCode, with the same port, bind address, origin rules, API token, and Basic Auth settings. When another OMMS process already serves the web app on the configured port, it SHALL follow the existing port ownership and takeover rules instead of starting a second server. Features that need a host, such as OpenCode's connected-model list, SHALL report that they are unavailable, with the existing reasons. It SHALL NOT start a backfill on its own. It SHALL run a host's backfill when the user starts or resumes it on the Settings page and that host's backfill model resolves to the external API.

#### Scenario: Opening the web app with no session open

- **WHEN** the user logs in and opens the web app URL without starting Pi or OpenCode
- **THEN** the memories, profile, and Settings pages SHALL load

#### Scenario: OpenCode starts while the login web app runs

- **WHEN** the login web app owns the port and OpenCode starts
- **THEN** OpenCode SHALL use the running web app instead of starting a second one

#### Scenario: The login web app does not backfill by itself

- **WHEN** the login web app starts with pending history and `autoBackfill` on
- **THEN** no backfill SHALL start until the user clicks Run now or Resume

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
