## ADDED Requirements

### Requirement: The page configures the external API

The Settings page SHALL have an **External API** card that edits `memoryProvider`, `memoryApiUrl`, `memoryModel`, and `memoryApiKey` in the global config. The provider SHALL be chosen from the providers OMMS supports. The card SHALL offer three key sources:

- **Environment variable**: the user types a variable name, and the page saves `env://NAME`.
- **Key file**: the user types the path of an existing file, and the page saves `file://` with that path.
- **Save key to a private file**: the user pastes the key once. The server SHALL write it to a file under `~/.config/omms/secrets/`, create the folder if needed, restrict the file to the current user (mode `600` on macOS and Linux, a user-only access list on Windows), and save `file://` with that path. It SHALL replace an existing key file only after the user confirms.

The key value SHALL NOT be written to `omms.jsonc`, the log, the capture trace, or any response, and the page SHALL NOT show it after saving. The card SHALL show the saved key source type and reference, whether the key resolves in the web app's own process, and, for an environment variable, that a login web app does not see variables set only in a shell profile. A **Test** button SHALL make one small call with the saved settings and report success or an error with the key redacted.

#### Scenario: Using an environment variable

- **WHEN** the user chooses Environment variable, types `ZAI_API_KEY`, and saves
- **THEN** the global config SHALL have `memoryApiKey` set to `env://ZAI_API_KEY`

#### Scenario: Saving a pasted key

- **WHEN** the user pastes a key, chooses Save key to a private file, and saves
- **THEN** the key SHALL be written to a user-only file under `~/.config/omms/secrets/`
- **AND** `memoryApiKey` SHALL be set to `file://` with that path
- **AND** no response or log line SHALL contain the key

#### Scenario: The variable is missing in the login web app

- **WHEN** `memoryApiKey` is `env://ZAI_API_KEY` and the login web app's process has no such variable
- **THEN** the card SHALL say that the key does not resolve in the web app and suggest a key file

#### Scenario: Testing the endpoint

- **WHEN** the user clicks Test and the endpoint rejects the key
- **THEN** the card SHALL show the error with the key redacted

## MODIFIED Requirements

### Requirement: Each host's capture model can be chosen on the page

The Settings page SHALL show one model card for OpenCode and one for Pi. Each card SHALL offer **Session model**, **Manual model**, and **External API**. Choosing Session model SHALL save the host's model as `inherit`. Choosing External API SHALL save the host's model as `external`. Choosing Manual model SHALL save the selected provider and model to that host's settings (`opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`). The manual picker SHALL list the host's signed-in models when the server can read them. Otherwise it SHALL accept a typed `provider/model` value and say that the list is not available. External API SHALL be selectable only when the external API is fully configured, and otherwise SHALL say which setting is missing. Each card SHALL show, read-only, the external API fallback and which model the live-model rule would choose now. The page SHALL NOT change the order of the live-model rule.

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
- **AND** it SHALL say that the list of signed-in models is not available

#### Scenario: A project config overrides the host model

- **WHEN** the current project's config sets the same model keys
- **THEN** the card SHALL say that the project value takes precedence for that project

### Requirement: Settings are saved safely to the global config

Saving on the Settings page SHALL write only the changed keys to the global config file that OMMS is reading. When that file is the legacy `~/.config/opencode/opencode-mem.jsonc`, the first save SHALL create `~/.config/omms/omms.jsonc` as a copy of it, comments included, apply the change there, and tell the user that OMMS now reads the new file. The legacy file SHALL NOT be written. Saves SHALL run one at a time, and a save SHALL be rejected without writing when the file changed after the page read it. Saving SHALL keep comments, key order, and all other keys. It SHALL reject values that fail the same validation used at startup, and SHALL leave the file unchanged when it rejects them. Running OpenCode and Pi processes SHALL use the saved values from their next capture without a restart. The page SHALL NOT write project config files. It SHALL NOT read or show secret values; it SHALL show only whether a secret is set, its source type (literal, `env://`, or `file://`), and, for `env://` and `file://`, the variable name or file path. The only secret the page SHALL change is `memoryApiKey`, and only to an `env://` or `file://` reference, including one created by saving a pasted key to a private key file. It SHALL NOT save a literal key to the config.

#### Scenario: A commented config file is edited

- **WHEN** the user saves a new Pi model and the config file has comments
- **THEN** the comments and every other key SHALL remain unchanged

#### Scenario: The install still uses the legacy config file

- **WHEN** only `~/.config/opencode/opencode-mem.jsonc` exists and the user saves a new Pi model
- **THEN** `~/.config/omms/omms.jsonc` SHALL be created with every key and comment from the legacy file plus the new Pi model
- **AND** the legacy file SHALL be unchanged
- **AND** the page SHALL say that OMMS now reads `~/.config/omms/omms.jsonc`

#### Scenario: The file changed while the page was open

- **WHEN** the config file is edited by hand, or by another process, after the page read it and before the page saves
- **THEN** the save SHALL be rejected without writing
- **AND** the page SHALL reload the current settings and ask the user to save again

#### Scenario: An invalid value is saved

- **WHEN** the user saves a retention of `0` days
- **THEN** the save SHALL be rejected with the reason, and the file SHALL be unchanged

#### Scenario: The running host picks up a change

- **WHEN** Pi is running and the user saves a new Pi model on the page
- **THEN** Pi's next capture SHALL use the new model without a restart

#### Scenario: A secret is configured

- **WHEN** `memoryApiKey` is set to `env://OMMS_KEY`
- **THEN** the page SHALL show that the key is set from the environment variable `OMMS_KEY` and SHALL NOT show its value

#### Scenario: A literal key is submitted as a reference

- **WHEN** a request tries to save `memoryApiKey` as a value that is not an `env://` or `file://` reference
- **THEN** the save SHALL be rejected and the file SHALL be unchanged

### Requirement: Changes from the page are access-controlled

Every Settings endpoint that changes config, saves a key file, deletes trace files, validates or browses an import source, lists import sessions, starts, pauses, resumes, or cancels an import or backfill, or makes a model test call SHALL require a JSON request body and SHALL reject requests whose origin is not allowed by the web server's origin rules. When the web server is bound to a non-loopback host, these endpoints SHALL also require the existing API token or Basic Auth credentials. Turning `captureTrace` on, and saving a pasted key to a key file, SHALL be rejected when the server is bound to a non-loopback host without Basic Auth.

#### Scenario: A request from another website

- **WHEN** a page on another origin sends a request to change settings
- **THEN** the server SHALL reject it and the config SHALL be unchanged

#### Scenario: A cross-site request tries to list sessions

- **WHEN** Basic Auth is on and a page on another site sends a request to list sessions without a JSON body
- **THEN** the server SHALL reject it before reading any history source or copying any file

#### Scenario: Turning on tracing over the network

- **WHEN** the server is bound to `0.0.0.0` without Basic Auth and a request turns tracing on
- **THEN** the server SHALL reject it

#### Scenario: Saving a key over the network

- **WHEN** the server is bound to `0.0.0.0` without Basic Auth and a request saves a pasted key
- **THEN** the server SHALL reject it and write no key file

### Requirement: The page controls automatic import

The Settings page SHALL have an **Automatic import** section with a switch for `autoBackfill` and, for each host, a model choice for `opencodeBackfillModel` or `piBackfillModel`: **Same as live capture** (saves `inherit`), **External API** (saves `external`), or a manual `provider/model` chosen the same way as the host's capture model. For each host the section SHALL show the backfill state, including paused, the counts of imported, skipped, failed, and pending exchanges, the number of sessions whose project cannot be resolved with a link to the Directory maps section, the model used, the cutoff, the last error, and the progress bar, percentage, and time left defined by the import progress capability. It SHALL offer Run now, Pause, and Resume for each host. The counts SHALL refresh while a run is active. It SHALL say that a model change takes effect at the next run, except that turning the switch off also stops a running backfill after its current exchange. It SHALL say that automatic import makes model calls.

#### Scenario: Turning automatic import off

- **WHEN** the user turns off the Automatic import switch and saves while a Pi backfill runs
- **THEN** the global config SHALL have `autoBackfill` set to `false`
- **AND** the Pi backfill SHALL stop after its current exchange

#### Scenario: Choosing a backfill model for Pi

- **WHEN** the user picks provider `zai` and model `glm-5-turbo` for Pi's backfill and saves
- **THEN** the global config SHALL have `piBackfillModel` set to `zai/glm-5-turbo`
- **AND** `piProvider` and `piModel` SHALL be unchanged

#### Scenario: Choosing the external API for OpenCode's backfill

- **WHEN** the user chooses External API for OpenCode's backfill and saves
- **THEN** the global config SHALL have `opencodeBackfillModel` set to `external`

#### Scenario: Watching progress

- **WHEN** a backfill runs while the section is open
- **THEN** the counts, progress bar, percentage, and time left SHALL update without a page reload
