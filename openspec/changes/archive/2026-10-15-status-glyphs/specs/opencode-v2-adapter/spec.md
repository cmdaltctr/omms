## MODIFIED Requirements

### Requirement: OpenCode shows OMMS status in its footer

When OMMS is installed in OpenCode from npm, the OpenCode prompt footer SHALL show `omms: ✔` when the web app answers its health route, and `omms: ✘ web app off` when it does not. Before the first health check answers, the footer SHALL show `omms: ⧖`. If the footer cannot start its status check, it SHALL show `omms: ✘`. Each glyph SHALL be a single-column text symbol, not a colour emoji. The footer SHALL update while OpenCode runs.

#### Scenario: Web app running

- **WHEN** OpenCode starts and the web app answers its health route
- **THEN** the footer SHALL show `omms: ✔`

#### Scenario: Web app stopped

- **WHEN** the web app does not answer its health route
- **THEN** the footer SHALL show `omms: ✘ web app off`

#### Scenario: First check has not answered

- **WHEN** OpenCode starts and the first health check has not answered yet
- **THEN** the footer SHALL show `omms: ⧖`

#### Scenario: The status check cannot start

- **WHEN** the footer fails to load its status check
- **THEN** the footer SHALL show `omms: ✘`

### Requirement: OpenCode tells the user about a newer OMMS release

At start and every 6 hours, OMMS in OpenCode SHALL read the `latest` version of `om-memory-system` from the npm registry. When it is newer than the running version and is not a prerelease, the footer SHALL add `· <version> available`, and OMMS SHALL show one toast that names `opencode plugin update om-memory-system`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** OpenCode runs OMMS 4.2.0 and npm `latest` is 4.3.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** a toast SHALL name `opencode plugin update om-memory-system`

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry
