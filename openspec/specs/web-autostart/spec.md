# web-autostart Specification

## Purpose

Keep the OMMS web app available whenever the user is logged in, without a Pi or OpenCode session open, and give the terminal a command to start it or manage its login item.

## Requirements

### Requirement: The web app starts at login by default

When `webServerAutoStart` is `true`, which is the default, and `webServerEnabled` is `true`, OMMS SHALL keep a login item that starts the web app when the user logs in: a LaunchAgent on macOS, a systemd user service on Linux, and a Startup-folder entry on Windows. The login item SHALL run the launcher at `~/.omms/bin/omms-launch.mjs` with the `web --login-item` arguments, so it starts the newest recorded OMMS copy. Each Pi or OpenCode start SHALL check the item and install it, or rewrite it when it runs an old runtime path or does not run that launcher. When either setting is `false`, the next check SHALL remove the item. OMMS SHALL only create, rewrite, or remove the item it owns, identified by a fixed name, and SHALL NOT touch other login items. Both settings SHALL be read from the global config only. A failure to install or remove the item SHALL be logged and SHALL NOT affect the session.

#### Scenario: First start after the upgrade on macOS

- **WHEN** OpenCode starts with `webServerAutoStart` unset and no OMMS LaunchAgent exists
- **THEN** OMMS SHALL install its LaunchAgent
- **AND** the web app SHALL start at the next login

#### Scenario: Turning the setting off

- **WHEN** the user sets `webServerAutoStart` to `false` and a host starts
- **THEN** OMMS SHALL remove its login item and leave other login items unchanged

#### Scenario: The package moved after an update

- **WHEN** the installed OMMS package path changes and a host starts
- **THEN** the login item SHALL still run `~/.omms/bin/omms-launch.mjs`, and the launcher SHALL start the copy at the new path

#### Scenario: An item from an older OMMS

- **WHEN** the login item runs `/opt/homebrew/lib/node_modules/om-memory-system/dist/cli/index.js` directly and a host starts
- **THEN** the login item SHALL be rewritten to run `~/.omms/bin/omms-launch.mjs`

#### Scenario: One project's web preference cannot disable the shared server

- **WHEN** the global `webServerEnabled` setting is `true` and project A sets it to `false`
- **THEN** the project setting SHALL be ignored
- **AND** project B SHALL still be able to use the shared web app

#### Scenario: An unsupported platform

- **WHEN** the platform has no supported login item mechanism
- **THEN** OMMS SHALL skip the item and report the platform as unsupported in its status

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

### Requirement: The web app reports the global command's version

The Settings page's **Web app** section SHALL show the running OMMS version and the version of the global `om-memory-system` install, read from that install's `package.json`, or that OMMS is not installed globally. It SHALL NOT run the global command to read its version. When the global install is older than the running version, the section SHALL say that a newer copy runs in its place, that a global install is optional, and show the command that upgrades it. When the global install is newer than the running version, the section SHALL warn about it and say that the next host start replaces the web app.

#### Scenario: The global command is older

- **WHEN** OMMS 4.3.2 runs and the global install's `package.json` has version `4.3.0`
- **THEN** the section SHALL say that 4.3.2 runs in place of the global 4.3.0 and show the upgrade command

#### Scenario: No global install

- **WHEN** no global `om-memory-system` install exists
- **THEN** the section SHALL say that it is not installed globally and that a global install is optional

### Requirement: Every host start makes sure one shared web app runs

When `webServerEnabled` is `true`, each OpenCode start, each Pi start, and each Claude Code hook SHALL check the configured port for an OMMS web app. When one answers with the same or a newer version than the newest recorded copy, or with a version that cannot be compared, the host SHALL use it and SHALL start nothing. When one answers with an older version, an OpenCode start, a Pi start, and a Claude Code `SessionStart` hook SHALL ask it to step aside through the local step-aside route, SHALL wait until the port is free, and SHALL then start the web app as for an empty port. When it does not step aside, the host SHALL use it and SHALL log a code. When none answers, the host SHALL start one standalone web app as a detached process on the configured port through the launcher, with the same runtime, bind address, and token rules as the login item and `om-memory-system web`. That web app SHALL keep running after the session ends. When several hosts start at the same time, at most one web app SHALL be started, and the other hosts SHALL wait for it and use it. A start that crashed SHALL NOT block a later start. When several hosts find the same stale start marker at the same time, exactly one of them SHALL replace it and start the web app, and the others SHALL wait for that web app. When a process that is not OMMS holds the configured port, the host SHALL start nothing and SHALL log a code. The check SHALL NOT block or fail the host session. When `webServerEnabled` is `false`, no host SHALL start a web app. The start rule SHALL live in shared code, and each host SHALL call it without host-specific logic.

#### Scenario: Pi starts with no web app running

- **WHEN** Pi starts and no OMMS web app answers on the configured port
- **THEN** Pi SHALL start one standalone web app in the background
- **AND** the Pi session SHALL start without waiting for it

#### Scenario: A host starts while the web app runs

- **WHEN** OpenCode, Pi, or a Claude Code hook starts and an OMMS web app of the newest recorded version answers on the configured port
- **THEN** it SHALL use that web app and SHALL start nothing

#### Scenario: A host update replaces an older web app

- **WHEN** the web app runs 4.3.0 and OpenCode starts OMMS 4.3.2
- **THEN** the 4.3.0 web app SHALL step aside
- **AND** a 4.3.2 web app SHALL serve the configured port without a new login

#### Scenario: Two hosts replace the same older web app

- **WHEN** the web app runs 4.3.0 and OpenCode and Pi start 4.3.2 at the same time
- **THEN** exactly one 4.3.2 web app SHALL serve the configured port
- **AND** both hosts SHALL use it

#### Scenario: An older web app does not step aside

- **WHEN** the web app runs an older OMMS without the step-aside route and a newer host starts
- **THEN** the host SHALL use the running web app and SHALL log a code
- **AND** the session SHALL start normally

#### Scenario: Two hosts start at the same time

- **WHEN** OpenCode and Pi start at the same time and no web app runs
- **THEN** exactly one standalone web app SHALL be started
- **AND** both hosts SHALL use it

#### Scenario: A crashed start

- **WHEN** a host crashed while it started the web app and left its start marker behind
- **THEN** the next host start SHALL still start the web app

#### Scenario: Two hosts recover the same crashed start

- **WHEN** a crashed start left its start marker behind and two hosts find that marker stale at the same time
- **THEN** exactly one host SHALL replace the marker and start the web app
- **AND** the other host SHALL NOT start a second web app and SHALL NOT remove the new marker

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

### Requirement: The login item keeps the newest OMMS copy

The login item SHALL run the launcher at the fixed path `~/.omms/bin/omms-launch.mjs`, and the launcher SHALL start the newest valid copy named by the newest-copy record. An older copy, such as a host's package cache, SHALL NOT replace the launcher or the record entry of a newer copy. When a host or the terminal installs the item, it SHALL first make sure the launcher exists at the fixed path.

#### Scenario: OpenCode starts an older cached copy

- **WHEN** the record names the global 4.2.0 copy and OpenCode starts OMMS 3.6.2 from its cache
- **THEN** the login item SHALL still start the global 4.2.0 copy at the next login

#### Scenario: A newer global install

- **WHEN** the record names a 4.1.0 copy and the global install is upgraded to 4.2.0
- **THEN** the next run of the global command SHALL record the 4.2.0 copy
- **AND** the next login SHALL start the web app from it

#### Scenario: A newer host copy

- **WHEN** the global install is 4.3.0 and Pi starts OMMS 4.3.2
- **THEN** the next login SHALL start the web app from the Pi 4.3.2 copy

#### Scenario: The recorded copy was removed before login

- **WHEN** the record names an OpenCode cache copy that OpenCode deleted, and the global install is 4.3.0
- **THEN** the login item SHALL start the web app from the global 4.3.0 copy

### Requirement: The terminal updates the global install and replaces the web app

The package SHALL provide `om-memory-system web update`. The command SHALL read npm `latest`. When the global `om-memory-system` install is missing or older than `latest`, the command SHALL run `npm install -g om-memory-system@<latest>` with the npm that sits beside the Node.js that runs the command, and SHALL stop npm after 5 minutes. After npm exits, the command SHALL read the global install's version from its `package.json`. When npm fails, times out, or leaves the global install on another version, the command SHALL print a failure code, SHALL exit with code `1`, and SHALL NOT stop any web app. When npm `latest` cannot be read, the command SHALL say so, SHALL skip npm, and SHALL continue. When the global install already has the `latest` version, the command SHALL skip npm and SHALL continue.

The command SHALL then replace every standalone OMMS web app on the machine with one fresh web app, also when the running web apps have the same version as the newest copy. It SHALL ask each standalone web app that waits for the port to exit, and SHALL ask the web app on the configured port to step aside. It SHALL hold the start lock while no web app serves, so that a host start in that time does not start a second web app. It SHALL start the fresh web app through the login item when the item is installed, and through the OMMS launcher otherwise, so that the newest OMMS copy on the machine serves. It SHALL wait up to 15 seconds for a web app to answer on the configured port, and SHALL then print `OMMS web app: <url> (version <version>)` and exit with code `0`. When no web app answers in that time, the command SHALL say so and SHALL exit with code `1`.

The command SHALL NOT stop a process that runs a host session. A web app inside an OpenCode session SHALL stop serving and SHALL keep the session running, as for a step-aside request. When the web app on the port cannot step aside, the command SHALL name its version, SHALL say how to stop it, and SHALL exit with code `1`. The command SHALL refuse to run, with the reason, when `webServerEnabled` is `false`. The command SHALL write log records with codes, versions, and durations, and SHALL NOT write npm output or the token to the log.

#### Scenario: The global install is older than npm latest

- **WHEN** the global install is 4.4.1, npm `latest` is 4.10.0, a standalone web app 4.10.0 serves the port, and the user runs `om-memory-system web update`
- **THEN** the global install SHALL be 4.10.0
- **AND** the 4.10.0 web app that served the port SHALL exit
- **AND** a new web app SHALL serve the port
- **AND** the command SHALL print `OMMS web app: <url> (version 4.10.0)` and exit with code `0`

#### Scenario: Everything is already on npm latest

- **WHEN** the global install and the running web app are both on npm `latest`
- **THEN** the command SHALL NOT run npm
- **AND** the running web app SHALL exit and a new web app SHALL serve the port

#### Scenario: No web app runs

- **WHEN** no web app answers on the configured port and the user runs `web update`
- **THEN** the command SHALL update the global install when it is older
- **AND** the command SHALL start a web app and print its URL and version

#### Scenario: A web app waits for the port

- **WHEN** a standalone web app serves the port, a second standalone web app waits for the port, and the user runs `web update`
- **THEN** both web apps SHALL exit
- **AND** only the fresh web app SHALL serve the port

#### Scenario: npm fails

- **WHEN** npm exits with an error during `web update`
- **THEN** the command SHALL print a failure code and exit with code `1`
- **AND** the running web app SHALL keep serving

#### Scenario: npm latest cannot be read

- **WHEN** the npm registry does not answer during `web update`
- **THEN** the command SHALL say that it could not check for a release
- **AND** the command SHALL replace the running web app

#### Scenario: A web app inside an OpenCode session serves the port

- **WHEN** a web app inside an OpenCode session serves the port and the user runs `web update`
- **THEN** that web app SHALL stop serving and the OpenCode session SHALL keep running
- **AND** the fresh web app SHALL serve the port

#### Scenario: A web app without the step-aside route serves the port

- **WHEN** OMMS 3.5.0 serves the port during `web update`
- **THEN** the command SHALL say that OMMS 3.5.0 holds the port and how to stop it
- **AND** the command SHALL exit with code `1`

### Requirement: The local terminal can replace a web app of the same version

A web app SHALL accept a step-aside request that asks for a replace from a caller on the loopback address that sends the local API token, also when the caller's version is the same or older. A step-aside request without the replace flag SHALL keep the current rule: the web app SHALL step aside only for a newer caller. A request without the token, or from an address other than loopback, SHALL be refused, and the web app SHALL keep serving.

#### Scenario: A replace request of the same version

- **WHEN** a loopback caller with the token sends a replace request with version 4.10.0 to a web app 4.10.0
- **THEN** the web app SHALL answer `202` and step aside

#### Scenario: A plain step-aside request of the same version

- **WHEN** a loopback caller with the token sends a step-aside request without the replace flag and with version 4.10.0 to a web app 4.10.0
- **THEN** the web app SHALL refuse it and SHALL keep serving

#### Scenario: A replace request without the token

- **WHEN** a replace request arrives without the local API token
- **THEN** the web app SHALL refuse it and SHALL keep serving

### Requirement: A waiting web app retires when the terminal asks

A standalone web app that waits for the port SHALL exit within 10 seconds after `web update` asks every web app started before a given time to retire, when the waiting web app started before that time. A web app that started after that time SHALL keep running. A web app inside an OpenCode session that waits for the port SHALL NOT exit and SHALL keep the session running.

#### Scenario: An older waiting web app

- **WHEN** a standalone web app started at 11:02 waits for the port and `web update` asks web apps started before 11:10 to retire
- **THEN** that web app SHALL exit within 10 seconds

#### Scenario: The fresh web app

- **WHEN** `web update` starts a fresh web app after it asked older web apps to retire
- **THEN** the fresh web app SHALL keep running
