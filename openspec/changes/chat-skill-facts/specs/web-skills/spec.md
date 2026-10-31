## MODIFIED Requirements

### Requirement: Turning on recording shows what is stored

When **Record agent turns** is on, the card SHALL show a warning callout. It SHALL say that OMMS stores full prompts, replies and tool calls in `skills.db` on this computer, that drafting sends recorded turns to the external API, and that the file holds whatever the turns hold. It SHALL also say that the memory chat sends skill counts and short change summaries to the external API, and no turn text.

#### Scenario: Recording on

- **WHEN** the user turns on **Record agent turns**
- **THEN** the warning callout SHALL appear in the card

#### Scenario: Chat named in the warning

- **WHEN** **Record agent turns** is on
- **THEN** the warning callout SHALL say that the memory chat sends skill counts and short change summaries to the external API
