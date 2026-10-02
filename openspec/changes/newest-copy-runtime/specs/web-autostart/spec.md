# Spec Delta

## MODIFIED Requirements

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
