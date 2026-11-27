## ADDED Requirements

### Requirement: Host and overview saves confirm first

On the host pages and the Memory overview these actions SHALL use the shared settings confirm dialog before they send a request: the host Save model, turning automatic import off, Use external API, Pause, Resume and Retry, Ignore on a folder row, and the opening context and compaction Save. The dialog content, Cancel and page checks SHALL follow the Settings rules. Turning automatic import on SHALL keep its existing dialog.

#### Scenario: Turn automatic import off

- **WHEN** the user clears "Import past chats automatically" for Pi
- **THEN** a confirm dialog opens, and Cancel leaves the box ticked

#### Scenario: Retry an import

- **WHEN** the user selects **Retry** on a host whose import failed
- **THEN** a confirm dialog says the retry calls the model again, and no run starts before the user confirms

#### Scenario: Use external API

- **WHEN** the user selects **Use external API** for OpenCode
- **THEN** a confirm dialog says OpenCode will use the external API model, and nothing is saved before the user confirms

#### Scenario: Opening context

- **WHEN** the user changes the opening context and selects **Save**
- **THEN** a confirm dialog lists the change and nothing is sent before the user confirms
