## ADDED Requirements

### Requirement: Every host runs the same learning pass

OpenCode, Pi and Claude Code SHALL run live profile learning through one pass with the same steps: skip trivial prompts, take a batch, build the model input, call the model, check the reply, merge, save, mark the prompts as learned, start the automatic cleanup when due, and send the notice. Only the model choice and the trigger SHALL differ by host. For the same prompts, profile and settings, every host SHALL send the same model input and save the same profile.

#### Scenario: The same batch on two hosts

- **WHEN** the same 10 waiting prompts and the same profile are learned once through Pi and once through OpenCode, with the same settings and the same model reply
- **THEN** both passes SHALL send the same model input
- **AND** both passes SHALL save the same profile data

#### Scenario: Claude Code has no host model

- **WHEN** a Claude Code pass runs
- **THEN** it SHALL use the external API only, as the live model rule says

### Requirement: Learning runs without a user email by default

When no user email is known (no `userEmailOverride` and no git `user.email`), live learning SHALL follow `userProfileWithoutEmail`. With `learn`, the default, it SHALL learn into the profile with the id `unknown`. With `skip`, it SHALL log a warning with the code `no-user-email`, make no model call, and leave the prompts waiting.

#### Scenario: Pi without an email

- **WHEN** Pi reaches the learning interval and no email is known, and `userProfileWithoutEmail` is not set
- **THEN** Pi SHALL create or update the profile with the id `unknown`

#### Scenario: The user chose to skip

- **WHEN** `userProfileWithoutEmail` is `skip` and no email is known
- **THEN** no model call SHALL be made
- **AND** the prompts SHALL stay waiting

### Requirement: Old profile items do not fade before a merge by default

Live learning SHALL NOT apply confidence decay to the stored profile before it merges a new result, unless `userProfileDecayBeforeMerge` is `true`. When it is `true`, every host SHALL apply the decay and confirm items that waited for validation, before the analysis and again before each save retry. The default SHALL be `false`.

#### Scenario: The default

- **WHEN** a profile item was last seen 40 days ago and a learning pass saves on any host
- **THEN** the item's confidence SHALL be unchanged by that pass, apart from the merge of the new result

#### Scenario: Decay turned on

- **WHEN** `userProfileDecayBeforeMerge` is `true` and a Claude Code pass runs
- **THEN** the pass SHALL apply the same decay that OpenCode applied before this change

### Requirement: The model gets the full learning input by default

With `userProfilePromptDetail` set to `full`, the default, the model input SHALL hold the numbered prompts, a summary of the current profile, the analysis guidelines and the examples. With `prompts-only`, it SHALL hold only the numbered prompts. In both cases the input SHALL be cut to `userProfileMaxContextBytes` bytes of UTF-8 text, without splitting a character, and SHALL end with the truncation marker when it was cut.

#### Scenario: A first profile

- **WHEN** no profile exists and the setting is `full`
- **THEN** the input SHALL hold the prompts, the guidelines and the examples, and no profile summary

#### Scenario: A long batch

- **WHEN** the batch is 50 KB and `userProfileMaxContextBytes` is 32768
- **THEN** the input SHALL be at most 32768 bytes and SHALL end with the truncation marker

### Requirement: The check of older items is available on every host

When `userProfileValidationEnabled` is `true` and the profile has at least 5 preferences, every host SHALL ask the model to confirm, contradict or reword the top items, and SHALL apply the verdicts before the save. The setting SHALL default to `false`. With fewer than 5 preferences, the pass SHALL skip the check and log the reason.

#### Scenario: Turned on for Pi

- **WHEN** `userProfileValidationEnabled` is `true`, the profile has 8 preferences, and a Pi pass runs
- **THEN** the model input SHALL hold the validation task
- **AND** the saved history entry SHALL name the verdict counts

#### Scenario: The default

- **WHEN** the setting is not set
- **THEN** no host SHALL send the validation task

### Requirement: The history entry names the host and the prompt count

Each profile version saved by live learning SHALL have the history text "<Host> analysis of N prompts", where <Host> is the host's display name from the host registry. When the check of older items ran, the text SHALL add "; validated: " and the verdict counts.

#### Scenario: OpenCode learns 10 prompts

- **WHEN** an OpenCode pass learns 10 prompts
- **THEN** the history entry SHALL read "OpenCode analysis of 10 prompts"

#### Scenario: Claude Code learns 10 prompts

- **WHEN** a Claude Code pass learns 10 prompts
- **THEN** the history entry SHALL read "Claude Code analysis of 10 prompts"

### Requirement: Every host shows the same notice when learning ends

When a pass saves the profile and `showUserProfileToasts` is `true`, the host SHALL show the title "User profile updated" and the message "Analysed N prompts and updated your profile". OpenCode and Pi SHALL show it when the pass ends. Claude Code SHALL show it as a user line on a later hook. When the setting is `false`, no host SHALL show it. A failed pass SHALL NOT show it.

#### Scenario: Pi and OpenCode agree

- **WHEN** a Pi pass and an OpenCode pass each learn 10 prompts
- **THEN** both SHALL show "Analysed 10 prompts and updated your profile"

#### Scenario: Notices turned off

- **WHEN** `showUserProfileToasts` is `false` and a pass saves
- **THEN** no host SHALL show the notice

### Requirement: A failed host model falls back with a notice on OpenCode and Pi

When the OpenCode or Pi host model fails during a learning pass and the external API is fully configured, the pass SHALL repeat the call through the external API and SHALL show a short warning notice that names the host and the shortened reason. When the external API is not configured, the pass SHALL fail with the host model's error.

#### Scenario: OpenCode model fails

- **WHEN** the OpenCode host model times out and the external API is fully configured
- **THEN** the pass SHALL use the external API
- **AND** OpenCode SHALL show the warning "Using fallback provider"

#### Scenario: No external API

- **WHEN** the Pi host model fails and the external API is not configured
- **THEN** the pass SHALL fail with reason `error` or `timeout`, and SHALL start the 10-minute wait

### Requirement: Every learning reply is checked before it is merged

Every host SHALL check each model reply against the profile schema before the merge, including replies from the external API and from a host model with structured output. A reply that fails the check SHALL fail the pass with reason `invalid-reply`. The profile SHALL stay unchanged and the prompts SHALL stay waiting.

#### Scenario: A malformed external reply on OpenCode

- **WHEN** the external API returns `{"preferences": "nope"}` to an OpenCode pass
- **THEN** the pass SHALL fail with reason `invalid-reply`
- **AND** the stored profile SHALL be unchanged

### Requirement: Live learning continues during a catch-up run by default

With `userProfileDuringCatchUp` set to `learn`, the default, live passes on every host SHALL keep running while a profile catch-up run is active in any process. With `pause`, a live pass SHALL make no model call while a catch-up run is active in this process or holds the run record.

#### Scenario: Claude Code during a catch-up run

- **WHEN** a catch-up run is active and a Claude Code turn reaches the learning interval
- **THEN** the Claude Code pass SHALL run

#### Scenario: The user chose to pause

- **WHEN** `userProfileDuringCatchUp` is `pause` and a catch-up run is active
- **THEN** no live pass SHALL make a model call

### Requirement: Two runs never analyse the same prompt at once

A live pass and a catch-up run SHALL claim the prompts of a batch before the model call. A pass SHALL NOT take a prompt that another run has claimed in the last 10 minutes. A pass that saves SHALL mark its prompts as learned. A pass that fails SHALL release its claim. A claim older than 10 minutes SHALL count as released.

#### Scenario: A catch-up run and a live pass at the same time

- **WHEN** 55 prompts wait, a catch-up run claims 50, and a live pass starts before the catch-up batch ends
- **THEN** the live pass SHALL take only prompts that the catch-up run did not claim

#### Scenario: A crash leaves a claim

- **WHEN** a process claimed 10 prompts and stopped 11 minutes ago
- **THEN** the next pass SHALL be able to take those 10 prompts

### Requirement: Profile learning settings are global only

`userProfileWithoutEmail`, `userProfileDecayBeforeMerge`, `userProfilePromptDetail`, `userProfileDuringCatchUp`, `userProfileValidationEnabled` and `showUserProfileToasts` SHALL be read from the global config only. A project config value for any of them SHALL be ignored and SHALL be logged once with the key name. An invalid value SHALL be reported as a config problem that names the key and the accepted values.

#### Scenario: A project tries to turn on decay

- **WHEN** a project config sets `userProfileDecayBeforeMerge` to `true` and the global config does not
- **THEN** learning in that project SHALL NOT decay
- **AND** the log SHALL name the ignored key

#### Scenario: An invalid value

- **WHEN** the global config sets `userProfilePromptDetail` to `"short"`
- **THEN** the config problem SHALL name the key and the values `full` and `prompts-only`

## MODIFIED Requirements

### Requirement: The backlog can be caught up in one run

The Memory page's Profile learning section SHALL offer **Analyse waiting prompts** and the package SHALL offer `om-memory-system profile-catch-up`. Both SHALL first report the number of waiting prompts and the number of profile analysis calls, leaving out trivial prompts, which are skipped without a model call, and SHALL start only after the user confirms (on the page) or passes `--yes` (in the terminal). The page SHALL explain that these are prompts already inside OMMS, that completed history is not re-analysed by this action, and that additional matching, deduplication, or retry calls can occur. The run SHALL analyse waiting prompts oldest first in batches of 50, with the saved external API by default. The terminal command SHALL accept the same model options as the history imports (`--provider`, `--model`, `--api-url`, `--api-key-env`) and `--dry-run`. Only one catch-up run SHALL run at a time across every process. A live pass SHALL run beside it or pause, as `userProfileDuringCatchUp` says, and the two SHALL never take the same prompt. When a run starts while another run in a different process holds the run record, the newest run SHALL take over: the older run SHALL stop before its next batch with the message that a newer run took over, and the newer run SHALL wait until the older run's current batch ends before it sends its first batch, so no batch is sent twice. A run record not refreshed for 10 minutes SHALL expire. A second start inside the same web app while its own run is active SHALL be refused with `409`. The page SHALL show progress and SHALL offer **Pause** and **Resume**. A failed batch SHALL stop the run with its reason code, and the next run SHALL continue from the prompts still waiting.

#### Scenario: Starting from the page

- **WHEN** 2,600 non-trivial prompts wait and the user presses **Analyse waiting prompts**
- **THEN** the page SHALL ask to confirm 52 profile analysis calls
- **AND** on confirm it SHALL show progress until the run ends
- **AND** it SHALL identify preferences, patterns, and workflows as the outputs

#### Scenario: Another model from the terminal

- **WHEN** the user runs `om-memory-system profile-catch-up --provider openai-chat --model other-model --api-url <url> --api-key-env KEY --yes`
- **THEN** the run SHALL use that model and SHALL NOT change the saved config

#### Scenario: A terminal run takes over from the page

- **WHEN** a catch-up run from the page is sending a batch and the user starts `om-memory-system profile-catch-up --yes`
- **THEN** the terminal run SHALL wait until that batch ends, then continue with the prompts still waiting
- **AND** the page SHALL show that a newer run took over, and SHALL send no more batches

#### Scenario: A run that crashed

- **WHEN** a run stopped without clearing its run record and 10 minutes have passed since the record was refreshed
- **THEN** a new run SHALL start without waiting

#### Scenario: A failed batch

- **WHEN** a batch times out during a catch-up run
- **THEN** the run SHALL stop with reason `timeout`
- **AND** the prompts already analysed SHALL stay marked as learned

#### Scenario: A live pass during a run

- **WHEN** a catch-up run is active and `userProfileDuringCatchUp` is not set
- **THEN** a live pass SHALL run on prompts that the catch-up run has not claimed

### Requirement: Learning merges again after a save conflict

When a learning save fails because the stored version changed, learning SHALL load the stored profile, merge the same analysis result into it, and save again with the new version. It SHALL NOT call the analysis model again. It SHALL make at most three save attempts. When all three fail, the profile SHALL stay unchanged, the analysed prompts SHALL stay unanalysed for a later run, and live learning in that process SHALL wait 10 minutes before its next pass. Claude Code, Pi, OpenCode and the backlog catch-up SHALL behave the same.

#### Scenario: A category cleanup lands during learning

- **WHEN** learning reads the profile, a category cleanup renames 510 items, and learning then saves
- **THEN** the first learning save SHALL fail
- **AND** learning SHALL merge its result into the cleaned profile and save it
- **AND** the 510 items SHALL keep their new categories

#### Scenario: No second model call

- **WHEN** a learning save fails once and the second attempt succeeds
- **THEN** the analysis model SHALL have been called once for that batch

#### Scenario: Every attempt fails

- **WHEN** three learning save attempts in a row meet a newer version
- **THEN** learning SHALL stop without saving
- **AND** the prompts in that batch SHALL NOT be marked as analysed

#### Scenario: Pi waits after three conflicts

- **WHEN** three Pi save attempts in a row meet a newer version and the user sends more turns within 10 minutes
- **THEN** Pi SHALL make no learning model call for those turns
