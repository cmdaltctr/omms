## ADDED Requirements

### Requirement: Pi installs a newer OMMS release in the background

On `session_start`, when OMMS in Pi was installed from npm without a pinned version, the Pi adapter SHALL read the `latest` version of `om-memory-system` from the npm registry. When it is newer than the running version and is not a prerelease, the adapter SHALL run `pi update npm:om-memory-system` in a detached process and SHALL NOT wait for it. The adapter SHALL NOT start a second update for the same release within 30 minutes, across all Pi sessions on the computer.

#### Scenario: A release is approved while Pi is closed

- **WHEN** a Pi session starts with OMMS 4.2.0 from npm and npm `latest` is 4.3.0
- **THEN** the adapter SHALL start `pi update npm:om-memory-system` in the background
- **AND** the log SHALL hold a `Pi plugin self-update` record with code `started`

#### Scenario: OMMS is current

- **WHEN** the running version and npm `latest` are both 4.3.0
- **THEN** the adapter SHALL NOT run the update command
- **AND** the adapter SHALL show no update notice

#### Scenario: A second session starts soon after

- **WHEN** an update for 4.3.0 started less than 30 minutes ago
- **THEN** a new Pi session SHALL NOT start another update

#### Scenario: OMMS runs from a local checkout or a pinned version

- **WHEN** Pi loads OMMS from a local path, or the configured source names a version
- **THEN** the adapter SHALL NOT run the update command
- **AND** the adapter SHALL show one notification that names `pi update npm:om-memory-system`

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** the adapter SHALL NOT contact the npm registry

### Requirement: The Pi background update is safe and logged

The background update SHALL run apart from memory work. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check and the update off. A failure SHALL NOT delay `session_start` or stop memory capture, retrieval, or the `memory` tool. A started or failed start SHALL write one `Pi plugin self-update` log record with a code and the two versions.

#### Scenario: The update command cannot start

- **WHEN** the update command cannot be started
- **THEN** memory capture, retrieval and the `memory` tool SHALL keep working
- **AND** the log SHALL hold one `Pi plugin self-update` record with code `spawn-failed` and no session content

#### Scenario: Updates are turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT run the update command

### Requirement: Pi tells the user to restart after a background update

While a Pi session with a user interface runs, when a background update installs the newer release, the OMMS footer label SHALL add `· <version> installed, restart`, and the adapter SHALL show one notification that says the release is installed and Pi must restart to use it. When the update command fails, the footer label SHALL add `· <version> available` and the adapter SHALL show one notification that names `pi update npm:om-memory-system`. The suffix SHALL stay when the status glyph changes.

#### Scenario: The background update succeeds

- **WHEN** the background update for 4.3.0 exits with success
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 installed, restart`
- **AND** one notification SHALL tell the user to restart Pi

#### Scenario: The background update fails

- **WHEN** the background update for 4.3.0 exits with an error
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one notification SHALL name `pi update npm:om-memory-system`

#### Scenario: Retrieval runs after the update

- **WHEN** the footer shows `· 4.3.0 installed, restart` and retrieval starts
- **THEN** the footer SHALL show `omms: ↻ · 4.3.0 installed, restart`
