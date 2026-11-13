# Spec Delta

## Purpose

Let the user choose OpenRouter as the memory model endpoint and control which OpenRouter providers may receive OMMS text, using OpenRouter's own data policy lists.

## ADDED Requirements

### Requirement: The External API card offers an OpenRouter preset

The External API card SHALL offer a **Preset** choice with **Custom** and **OpenRouter**. Choosing OpenRouter SHALL set the API URL to `https://openrouter.ai/api/v1` and the provider to `openai-chat`, and SHALL NOT change the model or the key source. The card SHALL treat any API URL whose host is `openrouter.ai` as OpenRouter. Every new text SHALL be available in English, Chinese and Arabic.

#### Scenario: Choosing the preset

- **WHEN** the user chooses the OpenRouter preset and saves
- **THEN** the global config SHALL have `memoryApiUrl` set to `https://openrouter.ai/api/v1` and `memoryProvider` set to `openai-chat`
- **AND** `memoryModel` and `memoryApiKey` SHALL keep their values

#### Scenario: A typed OpenRouter URL

- **WHEN** the saved API URL is `https://openrouter.ai/api/v1` and the preset was never chosen
- **THEN** the card SHALL show the OpenRouter routing block

### Requirement: The card lists the providers of the model with a data policy label

For OpenRouter, after the user enters a model ID, the card SHALL list each provider that serves the model once, by slug and name, with one label: **No retention**, **Abuse checks only** or **May keep or train on data**. A provider with several endpoints SHALL get the label of its least private endpoint.

#### Scenario: Several endpoints for one provider

- **WHEN** provider A serves the model through one endpoint on the zero data retention list and one that is not
- **THEN** the card SHALL show A once, labelled May keep or train on data

### Requirement: The web app reads OpenRouter's lists on the server

The web app SHALL read OpenRouter's model endpoint list and its zero data retention list on the server, without an API key, and SHALL send OpenRouter only the model ID. It SHALL cache the zero data retention list for at most one hour. A zero data retention endpoint marked as safety retention SHALL be labelled Abuse checks only.

#### Scenario: Labelled providers

- **WHEN** the model has providers A (on the zero data retention list), B (on it with safety retention) and C (not on it)
- **THEN** the card SHALL show A as No retention, B as Abuse checks only, and C as May keep or train on data

#### Scenario: OpenRouter cannot be reached

- **WHEN** a list request fails or takes longer than 10 seconds
- **THEN** the card SHALL say that the provider list is not available and why
- **AND** the switches and the manual provider field SHALL still work

#### Scenario: Unknown model

- **WHEN** OpenRouter returns no endpoints for the model ID
- **THEN** the card SHALL say that OpenRouter has no providers for that model

### Requirement: The card maps its choices to OpenRouter's provider fields

The card SHALL offer **Block providers that may train on or store data** (`data_collection: "deny"`), **Zero data retention only** (`zdr: true`), ticked providers in try order, a field to add a provider slug by hand, and **Use only these providers**. Ticked providers SHALL be saved as `order`. With Use only these providers on, they SHALL also be saved as `only` with `allow_fallbacks: false`.

#### Scenario: Fallback allowed

- **WHEN** the user ticks `deepinfra` then `novita` with Use only these providers off
- **THEN** the saved `provider` SHALL have `order` set to `["deepinfra", "novita"]` and no `only` field

#### Scenario: Zero data retention only hides other providers

- **WHEN** Zero data retention only is on
- **THEN** providers labelled May keep or train on data SHALL be shown disabled, with the reason

### Requirement: The routing choice is saved to memoryExtraParams.provider

The web app SHALL save the card's routing choice as `memoryExtraParams.provider` in the global config. It SHALL keep every other `memoryExtraParams` member and every `provider` field the card does not manage. It SHALL remove `provider` when the user clears every choice.

#### Scenario: Restricting to chosen providers

- **WHEN** the user turns on both switches, ticks `deepinfra`, turns on Use only these providers, and saves
- **THEN** `memoryExtraParams.provider` SHALL be `{ "data_collection": "deny", "zdr": true, "order": ["deepinfra"], "only": ["deepinfra"], "allow_fallbacks": false }`

#### Scenario: Other extra parameters stay

- **WHEN** `memoryExtraParams` holds `{ "thinking": { "type": "adaptive" } }` and the user saves a routing choice
- **THEN** `memoryExtraParams.thinking` SHALL be unchanged

#### Scenario: Clearing the choice

- **WHEN** the user clears every switch and provider and saves
- **THEN** `memoryExtraParams` SHALL have no `provider` member

### Requirement: Routing is saved only for a saved OpenRouter endpoint

The web app SHALL refuse a routing save that sets any routing field unless the saved `memoryApiUrl` has the host `openrouter.ai`. The card SHALL disable Save routing, with the reason, until the OpenRouter URL is saved. A save that clears every routing field SHALL always be allowed. When a `provider` object is saved and the API URL is not OpenRouter, the card SHALL warn that the routing is still sent with every request and SHALL offer to remove it.

#### Scenario: Routing before the endpoint is saved

- **WHEN** the saved API URL is `https://api.openai.com/v1` and a routing save sets `zdr`
- **THEN** the save SHALL be refused with a reason that names saving the OpenRouter endpoint first
- **AND** the global config SHALL be unchanged

#### Scenario: Removing stale routing

- **WHEN** `memoryExtraParams.provider` is saved and the user switches the API URL away from OpenRouter
- **THEN** the card SHALL show a warning and a Remove OpenRouter routing action
- **AND** confirming it SHALL remove `provider` from `memoryExtraParams`

### Requirement: Every memory-model call uses the saved routing

Every call to the memory model SHALL send the saved `memoryExtraParams.provider` object as the `provider` field of the request body. This SHALL include capture, profile learning, cleanup, tagging, chat and the Test button, on every host.

#### Scenario: The Test button follows the routing

- **WHEN** `memoryExtraParams.provider` is saved and the user clicks Test
- **THEN** the test request body SHALL contain the same `provider` object
