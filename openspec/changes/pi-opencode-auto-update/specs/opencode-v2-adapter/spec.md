## MODIFIED Requirements

### Requirement: OpenCode tells the user about a newer OMMS release

At start and every 6 hours, OMMS in OpenCode SHALL read the `latest` version of `om-memory-system` from the npm registry. When it is newer than the running version and is not a prerelease, the footer SHALL add `· <version> available`, and OMMS SHALL show one toast that names `opencode plugin update om-memory-system`. When OMMS has started a background update for that version, the toast SHALL say that the update is installing instead of naming the command. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** OpenCode runs OMMS 4.2.0 from a local path and npm `latest` is 4.3.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** a toast SHALL name `opencode plugin update om-memory-system`

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

## ADDED Requirements

### Requirement: OpenCode installs a newer OMMS release in the background

When OMMS in OpenCode was installed from npm without a pinned version, and the update check finds a newer release that is not a prerelease, OMMS SHALL run `opencode plugin update om-memory-system` in a detached process and SHALL NOT wait for it. OMMS SHALL NOT start a second update for the same release within 30 minutes, across all OpenCode sessions on the computer.

#### Scenario: A release is approved while OpenCode is closed

- **WHEN** OpenCode starts with OMMS 4.2.0 from npm and npm `latest` is 4.3.0
- **THEN** OMMS SHALL start `opencode plugin update om-memory-system` in the background
- **AND** the log SHALL hold an `OpenCode plugin self-update` record with code `started`

#### Scenario: A second session starts soon after

- **WHEN** an update for 4.3.0 started less than 30 minutes ago
- **THEN** a new OpenCode session SHALL NOT start another update

#### Scenario: OMMS runs from a local checkout or a pinned version

- **WHEN** OpenCode loads OMMS from a local path, or the configured package names a version
- **THEN** OMMS SHALL NOT run the update command
- **AND** the footer and toast SHALL behave as in the newer-release requirement

### Requirement: The OpenCode background update is safe and logged

The background update SHALL run apart from memory work. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the update off. A failure SHALL NOT stop memory capture, retrieval, or the `memory` tool. A started or failed start SHALL write one `OpenCode plugin self-update` log record with a code and the two versions.

#### Scenario: The update command cannot start

- **WHEN** the update command cannot be started
- **THEN** memory capture, retrieval and the `memory` tool SHALL keep working
- **AND** the log SHALL hold one `OpenCode plugin self-update` record with code `spawn-failed` and no session content

#### Scenario: Updates are turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT run the update command

### Requirement: OpenCode tells the user to restart after a background update

When a background update installs the newer release, the footer SHALL show `· <version> installed, restart` in place of `· <version> available`, and OMMS SHALL show one toast that says the release is installed and OpenCode must restart to use it. When the update command fails, the footer SHALL keep `· <version> available` and OMMS SHALL show one toast that names `opencode plugin update om-memory-system`.

#### Scenario: The background update succeeds

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 installed, restart`
- **AND** one toast SHALL tell the user to restart OpenCode and run `opencode service restart`

#### Scenario: The background update fails

- **WHEN** the background update for 4.3.0 exits with an error
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one toast SHALL name `opencode plugin update om-memory-system`

### Requirement: The OpenCode restart notice names the background service

OpenCode's background service keeps the old OMMS copy loaded after the TUI restarts. The restart toast SHALL name `opencode service restart`.

#### Scenario: The restart toast names the service command

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the toast SHALL name `opencode service restart`
