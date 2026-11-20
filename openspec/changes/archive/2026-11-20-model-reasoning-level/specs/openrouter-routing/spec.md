# Spec Delta

## MODIFIED Requirements

### Requirement: The web app reads OpenRouter's model list on the server

The web app SHALL read OpenRouter's public model list on the server, without an API key, and SHALL cache a good answer for at most one hour. It SHALL send the page only the ID, the name and the reasoning facts of each model. The reasoning facts are `supported_efforts`, `default_effort` and `mandatory`, when the list gives them.

#### Scenario: Cached list

- **WHEN** the card asks for the model list twice within one hour
- **THEN** the server SHALL read OpenRouter's model list once

#### Scenario: Failed read is not cached

- **WHEN** a read of the model list fails
- **THEN** the next request SHALL try OpenRouter again

#### Scenario: Reasoning facts in the reply

- **WHEN** OpenRouter lists `deepseek/deepseek-v4.1-flash-1017` with reasoning `{ "mandatory": false, "default_enabled": true, "supported_efforts": ["max", "high", "low", "none"], "default_effort": "high" }`
- **THEN** the reply for that model SHALL hold its ID, its name, `supported_efforts` `["max", "high", "low", "none"]`, `default_effort` `"high"` and `mandatory` `false`
- **AND** the reply SHALL hold no other field of the model

## ADDED Requirements

### Requirement: The user can let OpenRouter choose the provider

The routing block SHALL offer a **Let OpenRouter choose the provider** switch, off by default. With the switch on, a routing save SHALL send no `order`, `only` or `allow_fallbacks`, and SHALL keep `data_collection` and `zdr` as the privacy switches set them. The provider ticks and Use only these providers SHALL be disabled, with the reason.

#### Scenario: Switch on with privacy kept

- **WHEN** Block providers that may train on or store data is on, `deepinfra` is ticked with Use only these providers on, and the user turns the switch on and saves
- **THEN** `memoryExtraParams.provider` SHALL be `{ "data_collection": "deny" }`

#### Scenario: Switch off keeps today's behaviour

- **WHEN** the switch is off and the user ticks `deepinfra` then `novita` and saves
- **THEN** the saved `provider` SHALL have `order` set to `["deepinfra", "novita"]`

### Requirement: The switch keeps the ticks for the page visit

Turning the switch on SHALL keep the ticked providers on the page, and turning it off in the same page visit SHALL show them again in the same try order. The ticks SHALL NOT be saved while the switch is on.

#### Scenario: Turning the switch off again

- **WHEN** `deepinfra` and `novita` are ticked, the user turns the switch on and then off without a reload
- **THEN** `deepinfra` and `novita` SHALL be ticked in positions 1 and 2

### Requirement: The switch shows the saved routing

When the card loads, the switch SHALL be on when a saved `provider` object exists and has neither `order` nor `only`. It SHALL be off in every other case, including when no `provider` object is saved.

#### Scenario: Saved routing without a provider list

- **WHEN** the saved `provider` is `{ "data_collection": "deny", "zdr": true }`
- **THEN** the switch SHALL be on after the card loads

#### Scenario: No saved routing

- **WHEN** `memoryExtraParams` has no `provider`
- **THEN** the switch SHALL be off after the card loads

### Requirement: Ticked providers are listed first

The provider list SHALL show the ticked providers first, in try order, then the other providers in OpenRouter's list order. The list SHALL take this order when the provider list loads and after a routing save, and SHALL then scroll to its top. A single tick or untick SHALL NOT move any row.

#### Scenario: Load with saved ticks

- **WHEN** OpenRouter lists providers A, B and C and the saved `order` is `["C", "A"]`
- **THEN** the rows SHALL be C, A, B

#### Scenario: Ticking by hand

- **WHEN** the rows are A, B, C with none ticked and the user ticks C
- **THEN** the rows SHALL stay A, B, C
- **AND** C SHALL show try position 1

#### Scenario: After a routing save

- **WHEN** the user ticks C in the rows A, B, C and saves the routing
- **THEN** the rows SHALL be C, A, B and the list SHALL show its top
