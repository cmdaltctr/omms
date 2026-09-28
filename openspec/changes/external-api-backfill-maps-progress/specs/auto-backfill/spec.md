## MODIFIED Requirements

### Requirement: Past chats are imported automatically when a host starts

When `autoBackfill` is `true`, which is the default, each host SHALL start a background import of its own chat history after it starts: Pi imports Pi sessions from its default sessions folder, and OpenCode imports sessions from its default database. The run SHALL cover every project whose directory can be resolved with the importer's project rules, including the saved directory maps in `importPathMaps`. It SHALL use the shared importer, its ledger, and the live capture pipeline, and it SHALL also record the imported prompts and build the user profile from them. The run SHALL start after a start-up delay and SHALL NOT delay session start, prompt handling, retrieval, or live capture. When `autoBackfill` is `false`, or when the user has paused that host's backfill, no automatic run SHALL start. `autoBackfill` SHALL be read from the global config only.

#### Scenario: A new machine with existing history

- **WHEN** Pi starts with `autoBackfill` on, and the Pi sessions folder holds sessions that were never imported
- **THEN** OMMS SHALL import their exchanges in the background
- **AND** the user profile SHALL be built from the imported prompts

#### Scenario: Automatic backfill is off

- **WHEN** a host starts with `autoBackfill` set to `false`
- **THEN** no automatic import SHALL start and no model call SHALL be made for past chats

#### Scenario: Start-up is not delayed

- **WHEN** a host starts with pending history
- **THEN** the session SHALL become usable without waiting for the backfill
- **AND** retrieval and live capture SHALL keep working while the backfill runs

#### Scenario: A project config sets the switch

- **WHEN** a project config sets `autoBackfill`
- **THEN** the value SHALL be ignored and the global value SHALL apply

#### Scenario: Sessions from a mapped directory

- **WHEN** a saved directory map covers sessions recorded in a deleted worktree
- **THEN** the backfill SHALL import them into the map's target project

#### Scenario: The backfill is paused

- **WHEN** the user has paused Pi's backfill and Pi starts
- **THEN** no Pi backfill SHALL start

### Requirement: Each host's backfill model is configurable

`opencodeBackfillModel` and `piBackfillModel` SHALL choose the model for each host's automatic backfill. The value `inherit`, which is the default, SHALL use the model that the host's live capture would use under the live-model rule. The value `external` SHALL use the external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`). A `provider/model` value SHALL use that model from the host's signed-in models. When the chosen model cannot be resolved, including an `external` value while the external API is not fully configured, the run SHALL NOT start and the status SHALL say why. The setting SHALL NOT change the model of live capture or of manual imports.

#### Scenario: A cheaper model for Pi's backfill

- **WHEN** `piBackfillModel` is `zai/glm-5-turbo` and `piModel` is another model
- **THEN** the Pi backfill SHALL call `zai/glm-5-turbo`
- **AND** Pi's live capture SHALL keep using its own model

#### Scenario: The chosen model is not signed in

- **WHEN** `opencodeBackfillModel` names a provider that OpenCode has not connected
- **THEN** no OpenCode backfill SHALL start
- **AND** the status SHALL say that the model is not available

#### Scenario: Backfill through the external API

- **WHEN** `opencodeBackfillModel` is `external` and the external API is fully configured
- **THEN** the OpenCode backfill SHALL call the external API
- **AND** OpenCode's live capture SHALL keep using its own model rule

#### Scenario: The external API is not configured

- **WHEN** `piBackfillModel` is `external` and `memoryModel` is not set
- **THEN** no Pi backfill SHALL start
- **AND** the status SHALL say that `memoryModel` is missing
