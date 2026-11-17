## ADDED Requirements

### Requirement: An empty memory space shows a welcome panel

When the active memory space holds no memories and no search or filter is active, the Memory page SHALL show a welcome panel in place of the bare empty-list line. The panel SHALL say in plain words that memories appear after the first sessions. When the space holds any memory, or a search or filter returns no rows, the page SHALL keep the existing empty-list line.

#### Scenario: New install

- **WHEN** the user opens the Memory page and the active space has no memories
- **THEN** the page SHALL show the welcome panel

#### Scenario: Search with no results

- **WHEN** the active space holds memories and a search returns none
- **THEN** the page SHALL show the existing empty-list line and no welcome panel

#### Scenario: Project filter with no rows

- **WHEN** the user picks a project in the project filter and that project has no memories
- **THEN** the page SHALL show the existing empty-list line and no welcome panel

### Requirement: The welcome panel shows each host's readiness

The welcome panel SHALL list OpenCode, Pi and Claude Code, each with its capture readiness in words: "Ready", or "Needs setup" with the reason, from the existing readiness data. It SHALL give a link that opens the External API card on the Settings page, and SHALL say that Claude Code capture needs it. A failed readiness request SHALL hide the host list and keep the rest of the panel.

#### Scenario: Claude Code not ready

- **WHEN** the external API has no key
- **THEN** the Claude Code line SHALL read "Needs setup" with the missing setting in plain words, such as "API key", and SHALL NOT show a config key name
- **AND** the External API link SHALL open the Settings page at the External API card

#### Scenario: Readiness request fails

- **WHEN** the readiness request fails
- **THEN** the panel SHALL show without the host list

### Requirement: The welcome panel works in every language and on a phone

Every string in the welcome panel SHALL exist in English, Chinese and Arabic. The panel SHALL mirror for Arabic, and SHALL fit a 390 px wide screen without sideways scrolling.

#### Scenario: Arabic on a phone

- **WHEN** the language is Arabic and the screen is 390 px wide
- **THEN** the panel SHALL show Arabic text, right-to-left, with no sideways scrolling
