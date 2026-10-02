# Spec Delta

## MODIFIED Requirements

### Requirement: Claude Code integrates through hooks and a terminal command

The Claude Code integration SHALL be a Claude Code plugin made of hook definitions and one skill. Every hook SHALL run the plugin's launcher with Node.js and the `claude-hook <event>` arguments. The launcher SHALL run the newest valid local OMMS copy when that copy's version is the same as or newer than the plugin's version. When no local copy is that new, the launcher SHALL run `npx --yes om-memory-system@<plugin version>` with the same arguments and input. The plugin SHALL NOT need a global `om-memory-system` install. The plugin SHALL NOT register an MCP server, SHALL NOT write to `CLAUDE.md`, and SHALL NOT read Claude Code's own model or login. The repository SHALL hold the plugin manifest, the hook file, the launcher, a marketplace file that points at the repository, and the skill, and the documentation SHALL show the hook entries for users who add them to their Claude Code settings by hand. Hook entries that run the `om-memory-system` command directly SHALL keep working.

#### Scenario: Installing the plugin

- **WHEN** the user adds the OMMS marketplace and installs the plugin in Claude Code
- **THEN** the `SessionStart`, `UserPromptSubmit`, and `Stop` hooks SHALL be active in the next Claude Code session
- **AND** no MCP server SHALL be listed for the plugin

#### Scenario: The plugin is newer than every local copy

- **WHEN** the plugin is 4.3.3, the newest local copy is the global 4.3.0, and `SessionStart` runs
- **THEN** the hook SHALL run OMMS 4.3.3 through `npx`
- **AND** that copy SHALL write itself into the newest-copy record

#### Scenario: A host copy is newer than the plugin

- **WHEN** the plugin is 4.3.3 and the record names a valid OpenCode 4.4.0 copy
- **THEN** the hook SHALL run the 4.4.0 copy and SHALL NOT run `npx`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH` and the record names a valid Pi copy at the plugin's version
- **THEN** the hooks SHALL run the Pi copy

#### Scenario: The command is not installed

- **WHEN** a hook runs, `om-memory-system` is not on the `PATH`, and no local copy is new enough
- **THEN** the launcher SHALL run the plugin's version through `npx`

#### Scenario: OMMS cannot run

- **WHEN** a hook runs and Node.js is missing, or no local copy is new enough and `npx` fails or runs out of time
- **THEN** Claude Code SHALL continue as if the hook returned nothing

#### Scenario: Hand-written hook entries

- **WHEN** the user's settings run `om-memory-system claude-hook session-start` directly
- **THEN** the hook SHALL still run, and the command SHALL hand off to the newest recorded copy

### Requirement: A hook starts the web app on demand

When a hook finds no OMMS web app on the configured port, it SHALL start one as a detached process with the same runtime, port, bind address, and token rules as the login item and `om-memory-system web`. It SHALL then wait for the web app to answer, up to the hook's time budget. The web app SHALL keep running after the Claude Code session ends. The hook SHALL follow the shared start rule for every host, so a hook and a host that start at the same time start at most one web app. When an OMMS web app already answers, the hook SHALL use it and SHALL NOT start a second server. Only `SessionStart` SHALL replace a running web app that is older than the newest recorded copy, under the shared start rule. `UserPromptSubmit` and `Stop` SHALL use any running OMMS web app, whatever its version.

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

#### Scenario: Session start finds an older web app

- **WHEN** the web app runs 4.3.0, the record names a valid 4.3.3 copy, and `SessionStart` runs
- **THEN** the 4.3.0 web app SHALL step aside and a 4.3.3 web app SHALL serve the port

#### Scenario: A prompt finds an older web app

- **WHEN** the web app runs 4.3.0, the record names a valid 4.3.3 copy, and `UserPromptSubmit` runs
- **THEN** the hook SHALL send its request to the 4.3.0 web app and SHALL NOT replace it
