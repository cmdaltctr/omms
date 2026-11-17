## ADDED Requirements

### Requirement: Every host tells the user when the web app cannot start

When a host start finds that the web app cannot start, the host SHALL tell the user in plain words with the fix, for two results: another program holds the configured port (`port-busy`), and no Node or Bun runtime was found (`no-runtime`). All three hosts SHALL use the same wording. The report SHALL NOT block or fail the host session. A web app that runs or starts SHALL produce no warning.

#### Scenario: Web app running

- **WHEN** a host starts and the OMMS web app answers on the port
- **THEN** no host SHALL show a web-start warning

#### Scenario: Session continues

- **WHEN** a host shows a web-start warning
- **THEN** the host session SHALL start normally

### Requirement: The web-start message names the fix

For `port-busy` the message SHALL name the port and say to stop the other program or set `webServerPort` to a free port. For `no-runtime` the message SHALL say to install Node 22.14 or later.

#### Scenario: Busy port message

- **WHEN** a host finds a program that is not OMMS on port 4747
- **THEN** the message SHALL name port 4747 and the two fixes

#### Scenario: No runtime message

- **WHEN** a host finds no Node or Bun runtime to start the web app
- **THEN** the message SHALL say to install Node 22.14 or later

### Requirement: Each host shows the web-start message in its own way

Pi SHALL show the message as a warning notification when the session has an interface, once per Pi process per result. OpenCode SHALL show it as it shows its other start notices. Claude Code SHALL show it to the user from the `SessionStart` hook only, not from prompt, subagent or stop hooks.

#### Scenario: Pi finds the port busy

- **WHEN** Pi starts a session and a program that is not OMMS answers on port 4747
- **THEN** Pi SHALL show one warning notification with the port message

#### Scenario: Pi starts a second session

- **WHEN** the same Pi process starts another session and the port is still busy
- **THEN** Pi SHALL NOT show the warning again

#### Scenario: Claude Code finds the port busy

- **WHEN** a `SessionStart` hook finds a program that is not OMMS on the configured port
- **THEN** the user SHALL see the same port message once in that session
- **AND** a later `UserPromptSubmit` hook SHALL NOT show it
