## MODIFIED Requirements

### Requirement: Chat needs the external memory model

The chat SHALL use only the external memory model settings: `memoryProvider`, `memoryModel`, `memoryApiUrl`, and `memoryApiKey`. The model server MAY run on this machine. A server at `localhost`, `127.0.0.1` or `::1` SHALL NOT need a key. Any other server needs a key. When the settings are incomplete, the chat page SHALL name the missing settings, link to the Settings page, and disable the question input. The page SHALL NOT show any key value.

#### Scenario: Key missing

- **WHEN** `memoryApiKey` is not set and `memoryApiUrl` is not an address on this machine
- **THEN** the chat page SHALL say that the memory API key is missing and link to Settings
- **AND** the question input SHALL be disabled

#### Scenario: Settings complete

- **WHEN** all required external memory model settings are set
- **THEN** the question input SHALL be enabled

#### Scenario: A model server on this machine needs no key

- **WHEN** `memoryApiUrl` names `localhost`, `127.0.0.1` or `::1`, `memoryModel` is set and `memoryApiKey` is not set
- **THEN** the question input SHALL be enabled
- **AND** the request to the model server SHALL carry no `Authorization` header

#### Scenario: A placeholder key is still refused

- **WHEN** `memoryApiKey` holds a placeholder value such as `sk-...`, whatever `memoryApiUrl` is
- **THEN** the chat page SHALL say that the memory API key is missing
