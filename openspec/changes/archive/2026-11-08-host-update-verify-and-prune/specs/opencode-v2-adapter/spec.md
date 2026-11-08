## ADDED Requirements

### Requirement: OpenCode reports an installed update only when the new copy is on disk

When the background update exits with success, OMMS SHALL read the installed OMMS copies before it shows `· <version> installed, restart`. When no installed copy holds the new version, OMMS SHALL treat the update as failed: the footer SHALL keep `· <version> available` and one toast SHALL name `opencode plugin update om-memory-system`.

#### Scenario: The update command changed nothing

- **WHEN** the background update for 4.3.0 exits with success and no installed copy holds 4.3.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 available`
- **AND** one toast SHALL name `opencode plugin update om-memory-system`

#### Scenario: The new copy is on disk

- **WHEN** the background update for 4.3.0 exits with success and a timestamped cache copy holds 4.3.0
- **THEN** the footer SHALL show `omms: ✔ · 4.3.0 installed, restart`

### Requirement: OpenCode removes old OMMS cache copies

When the OpenCode background service starts OMMS from a timestamped cache folder, OMMS SHALL remove each older OMMS copy in the same cache folder, without delaying the service. A copy that cannot be removed SHALL stay. Each pass SHALL write one `OpenCode cache clean-up` log record with counts only.

#### Scenario: An old copy is removed

- **WHEN** the service runs 4.3.0 from a folder installed 2 days ago and the cache holds 4.2.0 in an older folder
- **THEN** OMMS SHALL remove the 4.2.0 folder

#### Scenario: The update is recent

- **WHEN** the running folder was installed 3 hours ago
- **THEN** OMMS SHALL remove no folder

#### Scenario: The recorded copy is kept

- **WHEN** `~/.omms/runtime.json` records the 4.2.0 folder
- **THEN** OMMS SHALL keep the 4.2.0 folder

#### Scenario: A folder cannot be removed

- **WHEN** the removal of an old folder fails
- **THEN** the folder SHALL stay, the service SHALL keep working, and the log record SHALL count it as kept

### Requirement: The OpenCode cache clean-up keeps copies that may still run

The clean-up SHALL keep the running copy, every newer copy, the copy that `~/.omms/runtime.json` records, and every copy without a readable version. It SHALL remove no copy while the running copy is less than 24 hours old.

#### Scenario: A newer copy is kept

- **WHEN** the service runs 4.3.0 and the cache also holds 4.4.0 in a newer folder
- **THEN** OMMS SHALL keep the 4.4.0 folder

#### Scenario: A copy without a version is kept

- **WHEN** an older folder has no readable `package.json`
- **THEN** OMMS SHALL keep that folder
