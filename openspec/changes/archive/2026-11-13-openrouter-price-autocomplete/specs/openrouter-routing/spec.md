## ADDED Requirements

### Requirement: Each provider row shows the provider's price

Each provider row in the routing block SHALL show that provider's price for the model, as input and output in US dollars per 1M tokens. The price SHALL come from the model endpoint list that the block already reads. A provider with several endpoints SHALL show the lowest input price and the lowest output price of its endpoints. A price of zero SHALL show as Free.

#### Scenario: Price shown

- **WHEN** OpenRouter lists provider A for the model with an input price of 0.000000256 and an output price of 0.000000712 US dollars per token
- **THEN** the row of A SHALL show $0.26 input and $0.71 output per 1M tokens

#### Scenario: Several endpoints

- **WHEN** provider A serves the model through two endpoints with input prices 0.0000003 and 0.0000002
- **THEN** the row of A SHALL show the input price $0.20 per 1M tokens

#### Scenario: No price in the list

- **WHEN** an endpoint of provider A has no readable price
- **THEN** the row of A SHALL show no price
- **AND** the row SHALL still show the name, slug and data policy label

#### Scenario: Free model

- **WHEN** every endpoint price of provider A is zero
- **THEN** the row of A SHALL show Free

### Requirement: The Model field suggests OpenRouter model IDs

When the API URL in the External API card is an OpenRouter URL, the Model field SHALL suggest OpenRouter model IDs that match the typed text. The user SHALL still be able to save any text as the model. The field SHALL suggest nothing when the URL is not OpenRouter.

#### Scenario: Typing part of a name

- **WHEN** the API URL is OpenRouter and the user types `deepseek` in the Model field
- **THEN** the field SHALL suggest the OpenRouter model IDs that contain `deepseek`, such as `deepseek/deepseek-v4-flash`

#### Scenario: Other URL

- **WHEN** the API URL is not OpenRouter
- **THEN** the Model field SHALL show no OpenRouter suggestions

#### Scenario: Model list not available

- **WHEN** the model list cannot be read
- **THEN** the Model field SHALL work as a plain text field

### Requirement: The web app reads OpenRouter's model list on the server

The web app SHALL read OpenRouter's public model list on the server, without an API key, and SHALL cache a good answer for at most one hour. It SHALL send the page only the ID and name of each model.

#### Scenario: Cached list

- **WHEN** the card asks for the model list twice within one hour
- **THEN** the server SHALL read OpenRouter's model list once

#### Scenario: Failed read is not cached

- **WHEN** a read of the model list fails
- **THEN** the next request SHALL try OpenRouter again
