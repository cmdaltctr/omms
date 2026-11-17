## ADDED Requirements

### Requirement: One global install runs at a time

Before it runs `npm install -g om-memory-system`, a web app (the automatic start or the Update button) or `om-memory-system web update` SHALL take the lock file `~/.omms/global-install.lock`. While npm runs, the lock SHALL also name npm's process. A lock is live while it is younger than 6 minutes and its holder or its npm runs. A caller that finds a live lock SHALL NOT run npm, and SHALL take over a lock that is not live. The holder SHALL release the lock after every outcome.

#### Scenario: Two web apps see the same release

- **WHEN** two web apps start an automatic install for 6.5.0 within the same second
- **THEN** exactly one SHALL run npm
- **AND** the other SHALL NOT run npm and SHALL log the code `install-busy`

#### Scenario: A held lock for the button or the terminal

- **WHEN** the user selects Update web app, or runs `om-memory-system web update`, while another install holds the lock
- **THEN** the web app SHALL report the failure code `install-busy` and keep serving
- **AND** the terminal command SHALL name the code and exit with 1

#### Scenario: The holder died

- **WHEN** the lock file names a process that is not running
- **THEN** the next caller SHALL take the lock and run its install

#### Scenario: The holder exits while npm still runs

- **WHEN** a web app exits during its install and its npm process still runs
- **THEN** the next caller SHALL NOT run npm and SHALL report `install-busy`
- **AND** once npm has ended and the global install is complete at the release, the next caller SHALL run no npm command

#### Scenario: The install fails

- **WHEN** npm exits with an error or the install times out
- **THEN** the lock SHALL be released before the caller reports the failure

### Requirement: The release is checked again under the lock

After it takes the lock, a caller SHALL read the version of the global install again. When that version is already the release it was going to install and the install passes the install check, the caller SHALL NOT run npm and SHALL go on to the restart.

#### Scenario: Another caller finished first

- **WHEN** a web app waits for a release that another caller has just installed into the global install
- **THEN** it SHALL run no npm command
- **AND** it SHALL restart onto the global install

### Requirement: An install is checked and repaired once

After npm exits with 0 and the global install reports the new version, the caller SHALL check the install with the valid-copy rule of the `web-autostart` capability. When the check fails, the caller SHALL run the same install once more under the same lock and check again. When the install is still incomplete, the web app SHALL NOT restart, SHALL keep serving its current version and SHALL report the failure code `incomplete-install`.

#### Scenario: A dependency folder is empty

- **WHEN** npm exits with 0 but a dependency folder of the new install is empty
- **THEN** the caller SHALL run the install a second time
- **AND** when the second check passes, the web app SHALL restart onto the new install

#### Scenario: The repair fails

- **WHEN** the second check still fails
- **THEN** the web app SHALL keep serving its current version
- **AND** the status SHALL report `incomplete-install`
- **AND** the update log SHALL hold the code and the missing dependency name, and no npm output

#### Scenario: A complete install

- **WHEN** the first check passes
- **THEN** the caller SHALL NOT run npm a second time

### Requirement: `web update` checks a global install on the latest version

When the global install already reports npm `latest`, `om-memory-system web update` SHALL run the install check under the install lock. It SHALL run no npm command for a complete install, and SHALL repair an incomplete one as the repair requirement says.

#### Scenario: A broken global install on latest

- **WHEN** the global install reports `latest` but a dependency folder is empty, and the user runs `om-memory-system web update`
- **THEN** the command SHALL run npm under the lock and SHALL replace the web app after the install check passes

#### Scenario: A complete global install on latest

- **WHEN** the global install reports `latest` and passes the install check
- **THEN** the command SHALL run no npm command and SHALL print that the global install is up to date

### Requirement: An exit waits for an install in progress

A web app that must exit while it runs an install (Stop, a hand-over, a step-aside or a retire request) SHALL stop serving at once and SHALL exit only after npm ends, at most 6 minutes later.

#### Scenario: Stop during an install

- **WHEN** the user selects Stop, or the web app is asked to step aside or retire, while its npm runs
- **THEN** the web app SHALL stop serving and SHALL exit with 0 only after npm ends, at most 6 minutes later

### Requirement: Repair advice takes the install lock

Every message and guide that tells the user how to repair or update the global install SHALL name `npx -p om-memory-system@latest om-memory-system web update` or `om-memory-system web update`. None SHALL name a raw `npm i -g om-memory-system`, which skips the install lock.

#### Scenario: The terminal install fails

- **WHEN** `om-memory-system web update` fails to install the release
- **THEN** it SHALL tell the user to run `om-memory-system web update` again later, and SHALL NOT name `npm i -g`

### Requirement: The update failure line names a next step

The web app's update dialog SHALL show, for the codes `install-busy`, `incomplete-install`, `network`, `permission` and `timeout`, one line that says what happened and what to do next, in English, Chinese and Arabic. For any other code it SHALL show the general failure line with the code.

#### Scenario: Another update installs

- **WHEN** the update fails with `install-busy`
- **THEN** the dialog SHALL say that another update is installing and to try again in a few minutes

#### Scenario: The install stays incomplete

- **WHEN** the update fails with `incomplete-install`
- **THEN** the dialog SHALL say that OMMS kept the current version and SHALL name `npx -p om-memory-system@latest om-memory-system web update`
