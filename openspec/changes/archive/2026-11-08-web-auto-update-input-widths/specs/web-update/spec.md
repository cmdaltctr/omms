# Spec Delta

## ADDED Requirements

### Requirement: The web app installs a newer release by itself

When its npm check finds a newer plain release, the standalone web app SHALL start the same install the **Update web app** action starts, by itself. It SHALL NOT do so when the update check is off, when it cannot install or restart, while an install or restart already runs, or when it serves inside a host session. After a failed automatic install it SHALL wait 30 minutes before another automatic attempt, and manual updates SHALL stay available during that wait.

#### Scenario: A release arrives while nobody watches

- **WHEN** the web app 5.8.0 runs, npm `latest` becomes 5.9.0, and no page is open
- **THEN** the web app SHALL install 5.9.0 into the global install
- **AND** a web app 5.9.0 SHALL serve the same port
- **AND** the update log SHALL hold one record for the automatic start with the running version and the new version, and no npm output

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK` is `1` and npm `latest` is newer
- **THEN** the web app SHALL NOT contact npm and SHALL NOT install
- **AND** `GET /api/web/status` SHALL report no update

#### Scenario: A gate fails

- **WHEN** npm `latest` is newer but the web app has no way to restart onto the new copy
- **THEN** the web app SHALL keep serving its current version without installing
- **AND** the update dialog SHALL keep explaining why the action is unavailable

#### Scenario: An automatic install fails

- **WHEN** an automatic install exits with an error
- **THEN** the web app SHALL keep serving its current version and report the failure code
- **AND** no second automatic install SHALL start for 30 minutes
- **AND** the update button SHALL still start a manual install

#### Scenario: A page is open during the automatic update

- **WHEN** an automatic install or restart runs with a page open
- **THEN** the page SHALL show the same progress it shows for the button
- **AND** when a web app with a new instance answers, the page SHALL reload itself without an update dialog open

#### Scenario: A web app inside a host session

- **WHEN** the web app serves inside a Pi or OpenCode session and npm `latest` is newer
- **THEN** the web app SHALL NOT install the release
