# web-update Specification

## Purpose

Tells a web page user when npm has a newer OMMS release, lists the update command for each host, and lets the user update the global install and restart the web app onto it with one action.

## Requirements

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

### Requirement: The page shows an update button when a release is available

When the status reports an update and the caller may control the web app, the sidebar footer SHALL show an update button. In the open desktop sidebar it SHALL sit in the footer row after the GitHub link and show the word for Update in the selected language. In the collapsed desktop sidebar it SHALL show an icon. On a narrow screen, where the footer row has no room, it SHALL show the word in its own row above the footer icons. The button SHALL have an accessible name that includes the new version. When there is no update, or the caller may not control the web app, the footer SHALL NOT show the button. Selecting the button SHALL open a dialog that shows the running version, the new version, and the update command for each host:

- Claude Code: `claude plugin update omms@omms`
- OpenCode: `opencode plugin update om-memory-system`
- Pi: `pi update npm:om-memory-system`
- Global command and web app: `npm i -g om-memory-system@latest && om-memory-system web install`

Each command SHALL have a copy action. The dialog SHALL say that OpenCode and Pi need their own update command and a restart.

#### Scenario: An update is available on this computer

- **WHEN** the status reports 4.10.0 and the caller is on a loopback address
- **THEN** the open desktop sidebar SHALL show a button labelled Update after the GitHub link
- **AND** the collapsed desktop sidebar SHALL show the button as an icon

#### Scenario: No update is available

- **WHEN** the status reports no update
- **THEN** the footer SHALL show only its current buttons

#### Scenario: A caller from another computer

- **WHEN** the status reports an update and the caller may not control the web app
- **THEN** the footer SHALL NOT show the update button

#### Scenario: Copying a command

- **WHEN** the user selects the copy action next to the OpenCode command
- **THEN** the clipboard SHALL hold `opencode plugin update om-memory-system`

### Requirement: The web app updates its global install and restarts onto it

The dialog SHALL offer an **Update web app** action. The web app SHALL accept `POST /api/web/update` only from a loopback caller that sends the local API token. It SHALL refuse a request without the token with `401`, a request from another address with `403`, and a request when there is no update with `409`. On success it SHALL answer `202` and then run `npm install -g om-memory-system@<new version>` with the npm that sits beside the Node.js that runs the web app. When that npm does not exist, the dialog SHALL disable the action and say why, and the route SHALL answer `409`. A second request while an update runs SHALL get `202` and SHALL NOT start another install. An update request while a Stop or Restart runs SHALL get `409`, and a Stop or Restart request while an update installs or restarts SHALL get `409`. The action SHALL be unavailable when the web app has no way to restart onto the new copy, checked before npm runs.

When the install succeeds and the global install reports the new version, the web app SHALL restart through the OMMS launcher, so the restart runs the newest copy on the machine. When the install fails, times out after 5 minutes, or leaves the global install on another version, the web app SHALL keep serving on its current version. `GET /api/web/status` SHALL report the update state: idle, installing, restarting, or failed with a code. The page SHALL show progress while the state is installing or restarting, SHALL reload when a web app with a new instance answers, and SHALL show the failure code when the state is failed. Each update SHALL write log records with codes, versions, and durations. The log SHALL NOT hold npm output or the token.

#### Scenario: A successful update

- **WHEN** the web app 4.9.0 runs, npm `latest` is 4.10.0, and the user selects Update web app
- **THEN** the global install SHALL be 4.10.0
- **AND** a web app 4.10.0 SHALL serve the same port
- **AND** the page SHALL reload and the header SHALL show `v4.10.0`

#### Scenario: npm fails

- **WHEN** the install exits with an error
- **THEN** the web app 4.9.0 SHALL keep serving
- **AND** the dialog SHALL show a failure code

#### Scenario: The install does not finish

- **WHEN** the install runs longer than 5 minutes
- **THEN** the web app SHALL stop the install and SHALL keep serving
- **AND** the status SHALL report the failure code `timeout`

#### Scenario: No npm beside Node.js

- **WHEN** the web app runs under a runtime with no npm beside it
- **THEN** the dialog SHALL disable Update web app and SHALL say that the commands above still work

#### Scenario: A request without the token

- **WHEN** an update request arrives without the API token
- **THEN** the web app SHALL refuse it with `401` and SHALL NOT run npm

#### Scenario: A request from a non-loopback address

- **WHEN** an update request arrives from an address that is not loopback
- **THEN** the web app SHALL refuse it with `403` and SHALL NOT run npm

#### Scenario: A repeated request

- **WHEN** an update request arrives while an install runs
- **THEN** the web app SHALL reply `202` and SHALL NOT start a second install

#### Scenario: Restart during an update

- **WHEN** an update installs and the user selects Restart or Stop
- **THEN** the web app SHALL refuse it with `409` and SHALL keep installing

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
