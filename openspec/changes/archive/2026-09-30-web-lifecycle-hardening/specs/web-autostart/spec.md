# Spec Delta

## MODIFIED Requirements

### Requirement: Every host start makes sure one shared web app runs

When `webServerEnabled` is `true`, each OpenCode start, each Pi start, and each Claude Code hook SHALL check the configured port for an OMMS web app. When one answers, the host SHALL use it and SHALL start nothing, whatever its version. When none answers, the host SHALL start one standalone web app as a detached process on the configured port, with the same runtime, bind address, and token rules as the login item and `om-memory-system web`. That web app SHALL keep running after the session ends. When several hosts start at the same time, at most one web app SHALL be started, and the other hosts SHALL wait for it and use it. A start that crashed SHALL NOT block a later start. When several hosts find the same stale start marker at the same time, exactly one of them SHALL replace it and start the web app, and the others SHALL wait for that web app. When a process that is not OMMS holds the configured port, the host SHALL start nothing and SHALL log a code. The check SHALL NOT block or fail the host session. When `webServerEnabled` is `false`, no host SHALL start a web app. The start rule SHALL live in shared code, and each host SHALL call it without host-specific logic.

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
