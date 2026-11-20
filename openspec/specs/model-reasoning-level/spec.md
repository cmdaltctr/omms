# model-reasoning-level Specification

## Purpose

Let the user choose how much the external API model reasons for capture, profile learning and AI Cleanup, and write the reasoning field that the saved endpoint reads.

## Requirements

### Requirement: The External API card offers a reasoning level

The External API card SHALL show a **Reasoning level** choice when the saved provider is `openai-chat` or `openai-responses`. For the `anthropic`, `minimax`, `google-gemini` and `orcarouter` providers it SHALL show no choice and SHALL say that their reasoning is set in `memoryExtraParams` in the config file. Every new text SHALL be available in English, Chinese and Arabic.

#### Scenario: OpenAI Chat endpoint

- **WHEN** the saved provider is `openai-chat`
- **THEN** the card SHALL show the Reasoning level choice

#### Scenario: Anthropic endpoint

- **WHEN** the saved provider is `anthropic`
- **THEN** the card SHALL show no Reasoning level choice
- **AND** the card SHALL say that reasoning for this provider is set in the config file

### Requirement: Default sends no reasoning field

The Reasoning level choice SHALL start at **Default** when no reasoning field is saved. Saving Default SHALL remove `reasoning`, `reasoning_effort` and `thinking` from `memoryExtraParams`, so the endpoint uses the model's own default.

#### Scenario: Saving Default

- **WHEN** `memoryExtraParams` holds `{ "thinking": { "type": "disabled" }, "provider": { "zdr": true } }` and the user saves Default
- **THEN** `memoryExtraParams` SHALL be `{ "provider": { "zdr": true } }`

#### Scenario: Nothing saved

- **WHEN** `memoryExtraParams` has no reasoning field
- **THEN** the card SHALL show Default

### Requirement: An OpenRouter level is saved as reasoning.effort

When the saved API URL has the host `openrouter.ai`, a level SHALL be saved as `memoryExtraParams.reasoning` with `effort` set to the level. Off SHALL be saved as `effort: "none"`.

#### Scenario: Low on OpenRouter

- **WHEN** the saved API URL is `https://openrouter.ai/api/v1` and the user saves Low
- **THEN** `memoryExtraParams.reasoning` SHALL be `{ "effort": "low" }`

#### Scenario: Off on OpenRouter

- **WHEN** the saved API URL is `https://openrouter.ai/api/v1` and the user saves Off
- **THEN** `memoryExtraParams.reasoning` SHALL be `{ "effort": "none" }`

### Requirement: OpenRouter choices follow the model's reasoning facts

For an OpenRouter model in OpenRouter's model list, the card SHALL offer Default plus each effort in the model's `supported_efforts`, with `none` shown as Off. Default SHALL name the model's `default_effort` when the list gives one. The card SHALL NOT offer Off when the model's reasoning is `mandatory`.

#### Scenario: Model with four efforts

- **WHEN** the saved model is `deepseek/deepseek-v4.1-flash-1017` and its `supported_efforts` are `max`, `high`, `low` and `none` with `default_effort` `high`
- **THEN** the card SHALL offer Default (high), Off, Low, High and Max
- **AND** the card SHALL NOT offer Medium

#### Scenario: Mandatory reasoning

- **WHEN** the model's reasoning is `mandatory` and its `supported_efforts` are `high`, `medium` and `low`
- **THEN** the card SHALL NOT offer Off

### Requirement: An OpenRouter model without effort levels offers on and off

For an OpenRouter model whose reasoning facts have no `supported_efforts`, the card SHALL offer Default, Off and On. Off SHALL be saved as `reasoning: { "enabled": false }` and On as `reasoning: { "enabled": true }`. Off SHALL NOT be offered when the reasoning is `mandatory`.

#### Scenario: On for a model without effort levels

- **WHEN** the model's reasoning facts are `{ "mandatory": false, "default_enabled": true }` and the user saves On
- **THEN** `memoryExtraParams.reasoning` SHALL be `{ "enabled": true }`

### Requirement: An OpenRouter model without reasoning facts gets general choices

When the OpenRouter model list cannot be read, does not hold the saved model, or lists the saved model with no reasoning facts, the card SHALL offer Default, Off, Low, Medium and High. It SHALL say that OpenRouter uses the nearest level the model supports.

#### Scenario: Model list not available

- **WHEN** the API URL is OpenRouter and the model list cannot be read
- **THEN** the card SHALL offer Default, Off, Low, Medium and High with the nearest-level note

#### Scenario: Listed model without reasoning facts

- **WHEN** the model list holds the saved model and gives it no reasoning facts
- **THEN** the card SHALL offer Default, Off, Low, Medium and High with the nearest-level note

### Requirement: A DeepSeek level is saved as thinking

When the saved API URL has the host `api.deepseek.com`, the card SHALL offer Default, Off and On. Off SHALL be saved as `memoryExtraParams.thinking` set to `{ "type": "disabled" }`, and On as `{ "type": "enabled" }`.

#### Scenario: Off on DeepSeek

- **WHEN** the saved API URL is `https://api.deepseek.com` and the user saves Off
- **THEN** `memoryExtraParams.thinking` SHALL be `{ "type": "disabled" }`

### Requirement: An OpenAI Responses level is saved as reasoning.effort

When the saved provider is `openai-responses` and the URL is not OpenRouter, the card SHALL offer Default, Low, Medium and High. A level SHALL be saved as `memoryExtraParams.reasoning` set to `{ "effort": <level> }`.

#### Scenario: Medium on the Responses provider

- **WHEN** the saved provider is `openai-responses` with the URL `https://api.openai.com/v1` and the user saves Medium
- **THEN** `memoryExtraParams.reasoning` SHALL be `{ "effort": "medium" }`

### Requirement: Another OpenAI Chat endpoint gets reasoning_effort

When the saved provider is `openai-chat` and the URL host is neither `openrouter.ai` nor `api.deepseek.com`, the card SHALL offer Default, Low, Medium and High. A level SHALL be saved as `memoryExtraParams.reasoning_effort`. The card SHALL say that this endpoint may ignore or refuse the field.

#### Scenario: High on another endpoint

- **WHEN** the saved URL is `https://api.example.com/v1` with provider `openai-chat` and the user saves High
- **THEN** `memoryExtraParams.reasoning_effort` SHALL be `"high"`
- **AND** the card SHALL show the note that the endpoint may ignore or refuse it

### Requirement: A level save replaces older reasoning fields

Every level save SHALL remove `reasoning`, `reasoning_effort` and `thinking` from `memoryExtraParams` before it writes the field of the saved endpoint. It SHALL keep every other `memoryExtraParams` member, including `provider`, and the comments of the config file.

#### Scenario: A DeepSeek field on OpenRouter

- **WHEN** the saved API URL is OpenRouter, `memoryExtraParams` is `{ "thinking": { "type": "disabled" }, "provider": { "order": ["deepinfra"] } }` and the user saves Low
- **THEN** `memoryExtraParams` SHALL be `{ "provider": { "order": ["deepinfra"] }, "reasoning": { "effort": "low" } }`

### Requirement: The level is saved only for the saved endpoint

The web app SHALL choose the field from the saved `memoryApiUrl` and `memoryProvider`. The card SHALL disable the level save, with the reason, while the card shows an unsaved URL, provider or model. The server SHALL refuse a level that the saved endpoint does not accept. A Default save SHALL always be allowed.

#### Scenario: Unsaved endpoint edit

- **WHEN** the user has typed a new API URL and has not saved it
- **THEN** the level save SHALL be disabled with a reason that names saving the endpoint first

#### Scenario: Level the endpoint does not accept

- **WHEN** the saved URL is `https://api.example.com/v1` with provider `openai-chat` and a save asks for On
- **THEN** the server SHALL refuse the save with a reason
- **AND** the global config SHALL be unchanged

### Requirement: The card shows the saved level

The card SHALL show the level that the saved field of the endpoint holds. When that field holds a value the card cannot show as a level, the card SHALL show **Set in the config file** and SHALL keep the value until the user saves another level. Saving a level over such a value SHALL ask the user to confirm first.

#### Scenario: Saved effort on OpenRouter

- **WHEN** the saved API URL is OpenRouter and `memoryExtraParams.reasoning` is `{ "effort": "high" }`
- **THEN** the card SHALL show High

#### Scenario: Hand-written token budget

- **WHEN** the saved API URL is OpenRouter and `memoryExtraParams.reasoning` is `{ "max_tokens": 2000 }`
- **THEN** the card SHALL show Set in the config file

#### Scenario: Saving over a hand-written value

- **WHEN** the card shows Set in the config file and the user selects Save reasoning level
- **THEN** the card SHALL open a confirmation that says the config file value will be replaced
- **AND** nothing SHALL be sent until the user confirms
- **AND** a server error SHALL show inside the confirmation, which closes on success

### Requirement: The card warns about a reasoning field the endpoint ignores

The card SHALL warn when the saved API URL is OpenRouter and `memoryExtraParams.thinking` is saved, or when the saved API URL is DeepSeek and `memoryExtraParams.reasoning` is saved. The warning SHALL name the field, say that the endpoint ignores it, and say that saving a level replaces it.

#### Scenario: DeepSeek thinking sent to OpenRouter

- **WHEN** the saved API URL is OpenRouter and `memoryExtraParams.thinking` is `{ "type": "disabled" }`
- **THEN** the card SHALL warn that OpenRouter ignores `thinking`
- **AND** the card SHALL say that saving a level replaces it

### Requirement: Every external API call sends the saved level

Every call to the external API model SHALL send the saved reasoning field in the request body. This SHALL include capture, profile learning, AI Cleanup, tagging, chat and the Test button, on every host. A call that uses a host session model SHALL NOT send it.

#### Scenario: AI Cleanup batch

- **WHEN** `memoryExtraParams.reasoning` is `{ "effort": "low" }` and an AI Cleanup batch calls the external API
- **THEN** the request body SHALL contain `"reasoning": { "effort": "low" }`

#### Scenario: OpenCode host model

- **WHEN** live capture in OpenCode uses the OpenCode host model
- **THEN** OMMS SHALL NOT add the saved reasoning field to that call

### Requirement: A project config keeps the global reasoning field

When a project config sets `memoryExtraParams` and holds none of `reasoning`, `reasoning_effort` and `thinking`, the merged `memoryExtraParams` SHALL keep the global values of those three keys, as it keeps `provider`. When the project config holds any of the three, the project's reasoning fields SHALL win and no global reasoning field SHALL be kept.

#### Scenario: Project sets other members only

- **WHEN** the global `memoryExtraParams` is `{ "reasoning": { "effort": "low" } }` and a project config sets `memoryExtraParams` to `{ "top_p": 0.9 }`
- **THEN** the merged `memoryExtraParams` SHALL be `{ "top_p": 0.9, "reasoning": { "effort": "low" } }`

#### Scenario: Project sets its own reasoning field

- **WHEN** the global `memoryExtraParams` is `{ "reasoning": { "effort": "low" } }` and a project config sets `memoryExtraParams` to `{ "thinking": { "type": "disabled" } }`
- **THEN** the merged `memoryExtraParams` SHALL be `{ "thinking": { "type": "disabled" } }`
