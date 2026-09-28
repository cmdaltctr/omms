# Spec Delta

## MODIFIED Requirements

### Requirement: Each host's capture model can be chosen on the page

The Settings page SHALL show one model card for OpenCode and one for Pi. Each card SHALL offer **Session model**, **Manual model**, and **External API**. Choosing Session model SHALL save the host's model as `inherit`. Choosing External API SHALL save the host's model as `external`. Choosing Manual model SHALL save the selected provider and model to that host's settings (`opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`). The manual picker SHALL list the host's signed-in models when the server can read them. Otherwise it SHALL accept a typed `provider/model` value and SHALL show the server's reason for the missing list. Each reason SHALL say what happened and what the user can do next, in the page's language. The Automatic import section SHALL show the same reason when it offers a manual model for that host. External API SHALL be selectable only when the external API is fully configured, and otherwise SHALL say which setting is missing. Each card SHALL show, read-only, the external API fallback and which model the live-model rule would choose now. The page SHALL NOT change the order of the live-model rule.

#### Scenario: Switching OpenCode to the session model

- **WHEN** the user chooses Session model on the OpenCode card and saves
- **THEN** the global config SHALL have `opencodeModel` set to `inherit`
- **AND** the next OpenCode capture SHALL use the session's model

#### Scenario: Pinning a manual Pi model

- **WHEN** the user picks provider `zai` and model `glm-5.3` on the Pi card and saves
- **THEN** the global config SHALL have `piProvider` `zai` and `piModel` `glm-5.3`
- **AND** the next Pi capture SHALL use that model

#### Scenario: Choosing the external API for Pi

- **WHEN** the external API is fully configured and the user chooses External API on the Pi card and saves
- **THEN** the global config SHALL have `piModel` set to `external`
- **AND** the next Pi capture SHALL call the external API

#### Scenario: The Pi model list is not available

- **WHEN** the server cannot load the Pi SDK
- **THEN** the Pi card SHALL accept a typed `provider/model` value
- **AND** it SHALL say that OMMS could not read Pi's model list and that the user can type the model as `provider/model`

#### Scenario: Pi has no signed-in models

- **WHEN** the server loads the Pi SDK and no Pi provider is signed in
- **THEN** the Pi card SHALL say that Pi has no signed-in models
- **AND** it SHALL tell the user to sign in to a provider in Pi and reload the page

#### Scenario: OpenCode is not found

- **WHEN** no OpenCode session serves the web app and the server cannot find the `opencode` program
- **THEN** the OpenCode card SHALL accept a typed `provider/model` value
- **AND** it SHALL say that OMMS could not find OpenCode on this computer
- **AND** it SHALL tell the user to type the model as `provider/model`, or to open an OpenCode session and reload the page

#### Scenario: OpenCode does not start in time

- **WHEN** the private OpenCode server does not start or does not send its list within the time limit
- **THEN** the OpenCode card SHALL say that OpenCode took too long to send its model list
- **AND** it SHALL tell the user to reload the page or type the model as `provider/model`

#### Scenario: OpenCode has no signed-in models

- **WHEN** OpenCode answers with an empty model list after the time limit
- **THEN** the OpenCode card SHALL say that OpenCode has no signed-in models
- **AND** it SHALL tell the user to run `opencode auth login` and reload the page

#### Scenario: OpenCode sends a reply OMMS cannot read

- **WHEN** the private OpenCode server answers in a format OMMS does not know
- **THEN** the OpenCode card SHALL say that this OpenCode version sent a model list OMMS cannot read
- **AND** it SHALL tell the user to type the model as `provider/model`

#### Scenario: The reason in the Automatic import section

- **WHEN** the OpenCode model list is not available and the user opens the Automatic import section
- **THEN** the OpenCode backfill model choice SHALL show the same reason as the OpenCode model card

#### Scenario: The reason in another language

- **WHEN** the page language is Chinese or Arabic and a model list is not available
- **THEN** the reason SHALL be shown in that language

#### Scenario: A project config overrides the host model

- **WHEN** the current project's config sets the same model keys
- **THEN** the card SHALL say that the project value takes precedence for that project
