## ADDED Requirements

### Requirement: Pi records settled prompts for profile learning

After each settled Pi turn, the Pi adapter SHALL save the user prompt in the shared prompt store with the Pi session id and the user entry id, after `<private>` text is removed. A fully private prompt SHALL NOT be saved. The saved prompt SHALL be marked as captured, so no other host's capture takes it. Profile learning SHALL read Pi prompts from the store, not from a list in memory. A later Pi history import of the same session SHALL NOT save the prompt a second time.

#### Scenario: A settled Pi turn

- **WHEN** a Pi turn settles with the prompt "use bun not npm <private>token</private>"
- **THEN** the prompt store SHALL hold the prompt with the private part replaced by the redaction marker, as the other hosts store it, for that session and entry id
- **AND** the prompt SHALL wait for profile learning

#### Scenario: A Pi restart before the interval

- **WHEN** Pi records 6 prompts, restarts, and records 4 more with an interval of 10
- **THEN** the next pass SHALL learn all 10 prompts

#### Scenario: A history import after live recording

- **WHEN** the user imports the Pi history of a session whose prompts Pi already recorded live
- **THEN** no prompt of that session SHALL be saved twice
- **AND** no prompt SHALL be learned twice
