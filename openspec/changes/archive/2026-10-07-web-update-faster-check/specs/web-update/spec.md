## MODIFIED Requirements

### Requirement: The web app checks npm for a newer release

The web app SHALL read the version of the npm `latest` tag for `om-memory-system` when it starts and then every 10 minutes. When `GET /api/web/status` is read and the last check started more than 60 seconds earlier, the web app SHALL start a new check without delaying the reply. Reads that arrive while a check runs SHALL NOT start another request. A release SHALL count as an update only when it is newer than the running version and is not a prerelease. When `OMMS_DISABLE_UPDATE_CHECK` is `1`, the web app SHALL NOT contact npm and SHALL report no update. A failed check SHALL keep the result of the last successful check, SHALL write one log record with a code, and SHALL NOT affect the web app. `GET /api/web/status` SHALL report the newer version, or no version when there is no update.

#### Scenario: npm has a newer release

- **WHEN** the web app 4.9.0 runs and npm `latest` is 4.10.0
- **THEN** `GET /api/web/status` SHALL report 4.10.0 as the available update

#### Scenario: npm has the same release

- **WHEN** the web app 4.9.0 runs and npm `latest` is 4.9.0
- **THEN** `GET /api/web/status` SHALL report no update

#### Scenario: A release is approved while the page is open

- **WHEN** the web app 4.12.0 last checked npm 61 seconds ago and npm `latest` is now 4.13.0
- **AND** the open page reads `GET /api/web/status`
- **THEN** the web app SHALL read npm again
- **AND** a following status read SHALL report 4.13.0 as the available update

#### Scenario: Two status reads during one check

- **WHEN** the page reads the status twice while a check runs
- **THEN** the web app SHALL send one request to npm

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK` is `1`
- **THEN** the web app SHALL NOT send a request to npm
- **AND** `GET /api/web/status` SHALL report no update

#### Scenario: npm cannot be reached

- **WHEN** the check fails because of a network error
- **THEN** the web app SHALL keep serving and SHALL keep the last known result
