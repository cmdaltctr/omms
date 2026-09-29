# Spec Delta

## MODIFIED Requirements

### Requirement: A hook starts the web app on demand

When a hook finds no OMMS web app on the configured port, it SHALL start one as a detached process with the same runtime, port, bind address, and token rules as the login item and `om-memory-system web`. It SHALL then wait for the web app to answer, up to the hook's time budget. The web app SHALL keep running after the Claude Code session ends. The hook SHALL follow the shared start rule for every host, so a hook and a host that start at the same time start at most one web app. When an OMMS web app already answers, the hook SHALL use it and SHALL NOT start a second server.

#### Scenario: First hook of the day

- **WHEN** `SessionStart` runs and no OMMS web app is running
- **THEN** the hook SHALL start the web app in the background
- **AND** a later `UserPromptSubmit` in the same session SHALL get memories from that web app

#### Scenario: OpenCode already serves the web app

- **WHEN** an OpenCode start already started the shared web app and a Claude Code hook runs
- **THEN** the hook SHALL send its request to that web app and start nothing

#### Scenario: Pi already started the web app

- **WHEN** a Pi start already started the shared web app and a Claude Code hook runs
- **THEN** the hook SHALL send its request to that web app and start nothing
