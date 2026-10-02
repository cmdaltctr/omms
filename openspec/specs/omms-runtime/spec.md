# omms-runtime Specification

## Purpose

Make every OMMS entry point run the newest OMMS copy on the machine, so an update to any one host updates the terminal command, the Claude Code hooks, and the web app without a manual global install.

## Requirements

### Requirement: OMMS records the newest copy on the machine

OMMS SHALL keep one record of the newest OMMS copy in `~/.omms/runtime.json`. The record SHALL hold the copy's package folder and version. A copy is valid when its `package.json` names `om-memory-system`, its version can be compared, and it has `dist/cli/index.js`. Each OpenCode start, each Pi start, and each run of the `om-memory-system` command SHALL write its own copy into the record when the record is missing, when the recorded copy is no longer valid, or when its own version is newer. On equal versions, the record SHALL keep the copy it names. The record SHALL be written to a temporary file and renamed into place, so a reader never finds a partial file. The record SHALL be private to the user. A failure to read or write the record SHALL be logged with a code and SHALL NOT affect the session or the command. A copy with a version that cannot be compared SHALL NOT be recorded.

#### Scenario: A host update brings a newer copy

- **WHEN** the record names the global 4.3.0 copy and OpenCode starts OMMS 4.3.2 from its package cache
- **THEN** the record SHALL name the OpenCode 4.3.2 copy

#### Scenario: An older copy starts

- **WHEN** the record names a 4.3.2 copy and the global 4.3.0 command runs
- **THEN** the record SHALL still name the 4.3.2 copy

#### Scenario: The recorded copy was removed

- **WHEN** the record names a copy whose folder no longer exists and Pi starts OMMS 4.3.0
- **THEN** the record SHALL name the Pi 4.3.0 copy

#### Scenario: Two hosts start at the same time

- **WHEN** OpenCode with 4.3.2 and Pi with 4.3.1 write the record at the same time
- **THEN** the record SHALL be a complete file that names one valid copy
- **AND** the next start of either host SHALL leave the record naming the 4.3.2 copy

### Requirement: A launcher runs the newest copy

The package SHALL include a launcher script that needs only Node.js and its built-in modules. The launcher SHALL choose the newest valid copy among the copy in the record, the global install beside the running Node.js, and the copy that holds the launcher. It SHALL run that copy's `om-memory-system` command with the same arguments, standard input, standard output, standard error, and exit code. When the record names a copy that is not valid, the launcher SHALL skip it. When the newest copy writes the record, it SHALL also place its own launcher at `~/.omms/bin/omms-launch.mjs`, so the login item has a launcher at a fixed path.

#### Scenario: The launcher picks the newest copy

- **WHEN** the record names a 4.3.2 copy, the global install is 4.3.0, and the launcher runs `web`
- **THEN** the 4.3.2 copy SHALL start the web app

#### Scenario: The recorded copy is gone

- **WHEN** the record names a copy that was removed and the global install is 4.3.0
- **THEN** the launcher SHALL run the global 4.3.0 copy

#### Scenario: The fixed launcher follows updates

- **WHEN** Pi starts a 4.4.0 copy and the record named a 4.3.2 copy
- **THEN** `~/.omms/bin/omms-launch.mjs` SHALL be the 4.4.0 copy's launcher

### Requirement: An old command hands off to the newest copy

When the `om-memory-system` command starts and the record names a valid copy with a newer version than its own, the command SHALL run that copy's command with the same arguments, standard input, standard output, standard error, and exit code, and SHALL do nothing else. The hand-off SHALL happen at most once per command run. When the environment variable `OMMS_NO_HANDOFF` is `1`, the command SHALL run its own code and SHALL NOT hand off. `om-memory-system --version` SHALL print the version of the code that runs.

#### Scenario: The global command is older than a host copy

- **WHEN** the global command is 4.3.0, the record names a valid 4.3.2 copy, and the user runs `om-memory-system memory search "database choice"`
- **THEN** the 4.3.2 copy SHALL run the search and print its result
- **AND** the command SHALL exit with the 4.3.2 copy's exit code

#### Scenario: Printing the version after a hand-off

- **WHEN** the global command is 4.3.0 and the record names a valid 4.3.2 copy
- **THEN** `om-memory-system --version` SHALL print `4.3.2`

#### Scenario: Turning the hand-off off

- **WHEN** `OMMS_NO_HANDOFF=1` is set and the user runs `om-memory-system --version` from the global 4.3.0 install
- **THEN** the command SHALL print `4.3.0`

#### Scenario: The newer copy is the one that runs

- **WHEN** the record names the copy that is running
- **THEN** the command SHALL run its own code and SHALL NOT start another process
