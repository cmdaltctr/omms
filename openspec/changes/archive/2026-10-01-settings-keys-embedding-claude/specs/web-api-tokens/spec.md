## Purpose

Named, expiring API tokens that let scripts and other computers call the web app's API. OMMS stores only a hash of each token, shows a new token once, and lets only the local machine create or revoke tokens.

## ADDED Requirements

### Requirement: API tokens are named, expiring, and stored as hashes

The web app SHALL keep a list of API tokens. Each token SHALL have a name, a creation time, an expiry time or no expiry, and a last-used time. The web app SHALL store only a hash of each token value, in a file that only the user can read. A new token value SHALL be returned once, when it is created, and SHALL NOT be returned again by any route, log record, or error message.

#### Scenario: Creating a token

- **WHEN** the user creates a token named `ci` that expires in 30 days
- **THEN** the response SHALL contain the token value once
- **AND** the stored list SHALL contain the name, creation time, expiry time, and a hash, and SHALL NOT contain the value

#### Scenario: Listing tokens

- **WHEN** the page lists tokens
- **THEN** each row SHALL show name, creation time, expiry, and last-used time
- **AND** no row SHALL contain a token value or hash

### Requirement: A valid token authorises API requests

An API request that carries a token as a bearer token or in the OMMS token header SHALL be authorised when the token matches a stored hash and has not expired. The match SHALL use a constant-time comparison. A successful match SHALL update the token's last-used time. An expired or revoked token SHALL be refused with `401`. The local auth token file (`~/.omms/.auth-token`) SHALL keep working as before.

#### Scenario: A valid token

- **WHEN** a script sends a token that exists and has not expired
- **THEN** the request SHALL be served
- **AND** the token's last-used time SHALL be updated

#### Scenario: An expired token

- **WHEN** a script sends a token whose expiry time has passed
- **THEN** the web app SHALL answer `401`

#### Scenario: A revoked token

- **WHEN** the user revokes a token and a script then sends it
- **THEN** the web app SHALL answer `401`

### Requirement: Only the local machine manages tokens

Creating, listing, and revoking tokens SHALL require a loopback caller and the local auth token. A request from another address SHALL be refused with `403`, and a request without the local auth token with `401`.

#### Scenario: Creating a token from another computer

- **WHEN** a request to create a token comes from a non-loopback address
- **THEN** the web app SHALL answer `403` and SHALL NOT create a token

### Requirement: A network-bound web app needs a token or a password

When the web app listens on a non-loopback address, it SHALL start only when at least one unexpired token exists or Basic Auth is on. Otherwise it SHALL refuse to start and SHALL say which setting is missing.

#### Scenario: Network binding without protection

- **WHEN** `webServerHost` is `0.0.0.0`, no unexpired token exists, and Basic Auth is off
- **THEN** the web app SHALL refuse to start
- **AND** the message SHALL say to create an API token on the Settings page or set a browser password

### Requirement: The config token key is imported once

On start, when `webServerApiToken` in the global config holds a value and no token named `from config file` exists, the web app SHALL add that value to the token list as `from config file` with no expiry. After that, the web app SHALL NOT read `webServerApiToken` for authorisation. The config file SHALL NOT be changed by the import.

#### Scenario: Upgrading with a config token

- **WHEN** the global config sets `webServerApiToken` and the web app starts for the first time after upgrade
- **THEN** the token list SHALL contain `from config file` with no expiry
- **AND** a script that sends that token SHALL be served

#### Scenario: Editing the config key after the import

- **WHEN** the user changes `webServerApiToken` in the config after the import
- **THEN** the new value SHALL NOT authorise requests
- **AND** the Keys and access card SHALL say the key is no longer read and to use the token table
