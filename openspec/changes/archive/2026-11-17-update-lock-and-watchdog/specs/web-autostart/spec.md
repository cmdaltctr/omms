## ADDED Requirements

### Requirement: A copy with a missing dependency is not valid

A copy of OMMS SHALL count as valid only when, besides the existing rules, every dependency named in its `package.json` resolves from its folder or from a parent `node_modules`, and every package folder in its own `node_modules` holds a `package.json`. The launcher and the newest-copy record SHALL apply the same rule. When the newest copy is not valid, the launcher SHALL start the next valid copy.

#### Scenario: The newest global copy is incomplete

- **WHEN** the global copy 6.4.0 has an empty dependency folder and a Pi cache copy 6.3.0 is complete
- **THEN** the login item SHALL start the web app from the 6.3.0 copy

#### Scenario: No copy is valid

- **WHEN** every copy on the machine has a missing dependency
- **THEN** the launcher SHALL print one line that names the missing dependency and the command `npx -p om-memory-system@latest om-memory-system web update`, and SHALL exit with 1
- **AND** under the login item it SHALL first write the code `no-valid-copy` and the missing dependency to the OMMS log, then count the failed start

### Requirement: The login item restarts a web app that crashed

On macOS and Linux the login item SHALL restart the web app after it exits with an error or is killed by a signal, at most once every 30 seconds. It SHALL NOT restart it after an exit with 0. Stop, a hand-over to a newer web app, a retire request and the restart after an update SHALL exit with 0. After 5 failed starts within 10 minutes the launcher SHALL log the code `restart-limit` and exit with 0, and the item SHALL stay down until the next login or the next `om-memory-system web install`.

#### Scenario: A crash

- **WHEN** the web app exits with an error 3 minutes after it started
- **THEN** the login item SHALL start it again within 30 seconds

#### Scenario: The user stops it

- **WHEN** the user selects Stop in the web app
- **THEN** the web app SHALL exit with 0 and the login item SHALL NOT start it again

#### Scenario: A broken start repeats

- **WHEN** the web app fails to start 5 times within 10 minutes
- **THEN** the launcher SHALL log `restart-limit` and exit with 0
- **AND** no further start SHALL happen until the next login or `web install`

#### Scenario: A restart the user asked for

- **WHEN** the user selects Restart, or an update restarts the login item
- **THEN** that start SHALL NOT count as a failed start

#### Scenario: An item from an earlier version

- **WHEN** the login item was written by a version without the restart rule and the terminal or a host runs the install step
- **THEN** the item SHALL be rewritten with the restart rule
- **AND** a host's install step SHALL NOT start a second web app

#### Scenario: Windows

- **WHEN** the platform is Windows
- **THEN** the startup item SHALL stay as it is and the docs SHALL say it has no restart rule

### Requirement: The service manager limits starts of a launcher that cannot run

The Linux unit SHALL set `StartLimitIntervalSec=600` and `StartLimitBurst=6` under `[Unit]`. Restart, an update restart and `om-memory-system web install` SHALL clear the systemd start count before they start the unit. The docs SHALL say that macOS has no start limit beyond the 30-second throttle.

#### Scenario: The launcher cannot run on Linux

- **WHEN** the runtime of the Linux item is gone and the unit fails to start 5 times within 10 minutes
- **THEN** systemd SHALL stop starting it
- **AND** `om-memory-system web install` SHALL clear the count and start it again

#### Scenario: The user restarts often on Linux

- **WHEN** the user selects Restart 6 times within 10 minutes
- **THEN** each restart SHALL start the unit
