## ADDED Requirements

### Requirement: The terminal updates the global install and replaces the web app

The package SHALL provide `om-memory-system web update`. The command SHALL read npm `latest`. When the global `om-memory-system` install is missing or older than `latest`, the command SHALL run `npm install -g om-memory-system@<latest>` with the npm that sits beside the Node.js that runs the command, and SHALL stop npm after 5 minutes. After npm exits, the command SHALL read the global install's version from its `package.json`. When npm fails, times out, or leaves the global install on another version, the command SHALL print a failure code, SHALL exit with code `1`, and SHALL NOT stop any web app. When npm `latest` cannot be read, the command SHALL say so, SHALL skip npm, and SHALL continue. When the global install already has the `latest` version, the command SHALL skip npm and SHALL continue.

The command SHALL then replace every standalone OMMS web app on the machine with one fresh web app, also when the running web apps have the same version as the newest copy. It SHALL ask each standalone web app that waits for the port to exit, and SHALL ask the web app on the configured port to step aside. It SHALL hold the start lock while no web app serves, so that a host start in that time does not start a second web app. It SHALL start the fresh web app through the login item when the item is installed, and through the OMMS launcher otherwise, so that the newest OMMS copy on the machine serves. It SHALL wait up to 15 seconds for a web app to answer on the configured port, and SHALL then print `OMMS web app: <url> (version <version>)` and exit with code `0`. When no web app answers in that time, the command SHALL say so and SHALL exit with code `1`.

The command SHALL NOT stop a process that runs a host session. A web app inside an OpenCode session SHALL stop serving and SHALL keep the session running, as for a step-aside request. When the web app on the port cannot step aside, the command SHALL name its version, SHALL say how to stop it, and SHALL exit with code `1`. The command SHALL refuse to run, with the reason, when `webServerEnabled` is `false`. The command SHALL write log records with codes, versions, and durations, and SHALL NOT write npm output or the token to the log.

#### Scenario: The global install is older than npm latest

- **WHEN** the global install is 4.4.1, npm `latest` is 4.10.0, a standalone web app 4.10.0 serves the port, and the user runs `om-memory-system web update`
- **THEN** the global install SHALL be 4.10.0
- **AND** the 4.10.0 web app that served the port SHALL exit
- **AND** a new web app SHALL serve the port
- **AND** the command SHALL print `OMMS web app: <url> (version 4.10.0)` and exit with code `0`

#### Scenario: Everything is already on npm latest

- **WHEN** the global install and the running web app are both on npm `latest`
- **THEN** the command SHALL NOT run npm
- **AND** the running web app SHALL exit and a new web app SHALL serve the port

#### Scenario: No web app runs

- **WHEN** no web app answers on the configured port and the user runs `web update`
- **THEN** the command SHALL update the global install when it is older
- **AND** the command SHALL start a web app and print its URL and version

#### Scenario: A web app waits for the port

- **WHEN** a standalone web app serves the port, a second standalone web app waits for the port, and the user runs `web update`
- **THEN** both web apps SHALL exit
- **AND** only the fresh web app SHALL serve the port

#### Scenario: npm fails

- **WHEN** npm exits with an error during `web update`
- **THEN** the command SHALL print a failure code and exit with code `1`
- **AND** the running web app SHALL keep serving

#### Scenario: npm latest cannot be read

- **WHEN** the npm registry does not answer during `web update`
- **THEN** the command SHALL say that it could not check for a release
- **AND** the command SHALL replace the running web app

#### Scenario: A web app inside an OpenCode session serves the port

- **WHEN** a web app inside an OpenCode session serves the port and the user runs `web update`
- **THEN** that web app SHALL stop serving and the OpenCode session SHALL keep running
- **AND** the fresh web app SHALL serve the port

#### Scenario: A web app without the step-aside route serves the port

- **WHEN** OMMS 3.5.0 serves the port during `web update`
- **THEN** the command SHALL say that OMMS 3.5.0 holds the port and how to stop it
- **AND** the command SHALL exit with code `1`

### Requirement: The local terminal can replace a web app of the same version

A web app SHALL accept a step-aside request that asks for a replace from a caller on the loopback address that sends the local API token, also when the caller's version is the same or older. A step-aside request without the replace flag SHALL keep the current rule: the web app SHALL step aside only for a newer caller. A request without the token, or from an address other than loopback, SHALL be refused, and the web app SHALL keep serving.

#### Scenario: A replace request of the same version

- **WHEN** a loopback caller with the token sends a replace request with version 4.10.0 to a web app 4.10.0
- **THEN** the web app SHALL answer `202` and step aside

#### Scenario: A plain step-aside request of the same version

- **WHEN** a loopback caller with the token sends a step-aside request without the replace flag and with version 4.10.0 to a web app 4.10.0
- **THEN** the web app SHALL refuse it and SHALL keep serving

#### Scenario: A replace request without the token

- **WHEN** a replace request arrives without the local API token
- **THEN** the web app SHALL refuse it and SHALL keep serving

### Requirement: A waiting web app retires when the terminal asks

A standalone web app that waits for the port SHALL exit within 10 seconds after `web update` asks every web app started before a given time to retire, when the waiting web app started before that time. A web app that started after that time SHALL keep running. A web app inside an OpenCode session that waits for the port SHALL NOT exit and SHALL keep the session running.

#### Scenario: An older waiting web app

- **WHEN** a standalone web app started at 11:02 waits for the port and `web update` asks web apps started before 11:10 to retire
- **THEN** that web app SHALL exit within 10 seconds

#### Scenario: The fresh web app

- **WHEN** `web update` starts a fresh web app after it asked older web apps to retire
- **THEN** the fresh web app SHALL keep running
