# profile-learning Specification

## Purpose

Profile learning on the external API finishes, says why when it does not, and does not retry a failing batch after every turn.

## Requirements

### Requirement: Profile calls on the external API have their own time limit

A profile learning call through the external API SHALL be allowed 120 seconds for each model request, on every host and in history imports. Capture calls SHALL keep the time limit set by `autoCaptureIterationTimeout`.

#### Scenario: A slow profile reply

- **WHEN** the external API takes 66 seconds to answer a profile learning request
- **THEN** the profile SHALL be created or updated
- **AND** the batch of prompts SHALL be marked as learned

#### Scenario: Capture keeps its limit

- **WHEN** `autoCaptureIterationTimeout` is 30000 and a capture request takes longer than 30 seconds
- **THEN** the capture request SHALL time out as before

### Requirement: A failed profile step logs its reason

When profile learning fails, the log record SHALL name the host and a fixed reason code: `timeout`, `http-<status>`, `no-tool-call`, `invalid-reply`, `not-configured`, or `error`. The record SHALL NOT contain prompts, replies, or keys.

#### Scenario: A timeout

- **WHEN** a Claude Code profile learning call times out
- **THEN** the log SHALL contain one record with host `claude-code` and reason `timeout`

### Requirement: A failed profile step waits before it tries again

After profile learning fails in a process, that process SHALL NOT start another profile learning pass for 10 minutes. Capture and manual memory operations SHALL continue in that time. A pass that succeeds SHALL clear the wait.

#### Scenario: Turns after a failure

- **WHEN** profile learning fails and the user sends three more turns within 10 minutes
- **THEN** no profile learning call SHALL be made for those turns
- **AND** every turn SHALL still be captured

### Requirement: Live learning reads recent prompts first

A live profile learning pass SHALL take its batch from prompts recorded in the last 7 days, newest first. Only when no such prompt waits SHALL it take the oldest waiting prompts. The batch size SHALL stay `userProfileAnalysisInterval`.

#### Scenario: A backlog and new prompts

- **WHEN** 2,898 imported prompts from last month wait and 10 prompts from today wait
- **THEN** the next live pass SHALL analyse the 10 prompts from today

#### Scenario: Only old prompts wait

- **WHEN** no prompt from the last 7 days waits and old prompts do
- **THEN** a live pass SHALL analyse the oldest waiting prompts

### Requirement: Trivial prompts are not sent to the model

A waiting prompt whose trimmed text is shorter than 20 characters and has fewer than three words SHALL be marked as learned without a model call, in live learning, history imports, and the catch-up run. It SHALL NOT count toward the learning interval.

#### Scenario: A short reply

- **WHEN** the user's prompt is `yes go`
- **THEN** it SHALL be marked as learned without a model call

#### Scenario: A short preference

- **WHEN** the user's prompt is `use bun not npm`
- **THEN** it SHALL be sent to the model with the batch

### Requirement: The backlog can be caught up in one run

The Memory page's Profile learning section SHALL offer **Analyse waiting prompts** and the package SHALL offer `om-memory-system profile-catch-up`. The run SHALL analyse waiting prompts oldest first in batches of 50, with the saved external API by default. A failed batch SHALL stop the run with its reason code, and the next run SHALL continue from the prompts still waiting.

#### Scenario: A failed batch

- **WHEN** a batch times out during a catch-up run
- **THEN** the run SHALL stop with reason `timeout`
- **AND** the prompts already analysed SHALL stay marked as learned

### Requirement: Workflows have their own retention rule

Profile decay SHALL keep a workflow unless both of these are true: it was last seen more than `userProfileWorkflowStaleDays` days ago, and its support is below `userProfileMinEvidenceForRetention`. A workflow's support SHALL be the larger of its evidence count and its frequency. `userProfileWorkflowStaleDays` SHALL default to 30. When `userProfileStaleDays` is longer, workflows SHALL use `userProfileStaleDays`. Preferences and patterns SHALL keep the rule that uses `userProfileStaleDays` and their evidence count.

#### Scenario: A workflow seen once, three days ago

- **WHEN** a workflow has frequency 1, no evidence, and was last seen 3 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL keep the workflow

#### Scenario: A workflow seen once, 31 days ago

- **WHEN** a workflow has frequency 1, no evidence, and was last seen 31 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL remove the workflow

#### Scenario: A repeated workflow, 31 days ago

- **WHEN** a workflow has frequency 3, no evidence, and was last seen 31 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL keep the workflow

#### Scenario: A preference with no evidence, three days ago

- **WHEN** a preference has frequency 5, no evidence, and was last seen 3 days ago
- **AND** the settings are the defaults
- **THEN** decay SHALL remove the preference

### Requirement: A forced history import re-analyses profile prompts

When a history import runs with `--force` and without `--skip-profile`, it SHALL also process profile prompts that the ledger records as done. Each such prompt SHALL be recorded as waiting for profile learning, and the run SHALL analyse it with the waiting prompts. A prompt already in the prompt store SHALL be marked as waiting again, and SHALL NOT be stored a second time. A forced run SHALL re-analyse each prompt at most once: a later forced run SHALL skip prompts that an earlier forced run already re-analysed. Without `--force`, the import SHALL skip profile prompts that the ledger records as done. A dry run with `--force` SHALL count these prompts as prompts it would record, and SHALL make no model calls and no store changes. This SHALL apply to the OpenCode, Pi, and Claude Code imports, in the terminal, in every in-session import command, and on the Memory import page when re-analysis is enabled. **Re-analyse chat history** SHALL preset force, skip memories, and profile enabled, then require the same host/scope selection, preview, and confirmation as a normal history import. Grouped imports SHALL keep the same per-host replay identities.

#### Scenario: Rebuilding the profile from history

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs `om-memory-system import-pi-history --scope all-projects --force --skip-memories`
- **THEN** the run SHALL send those 1,000 prompts to profile learning in batches
- **AND** it SHALL create no memories

#### Scenario: A second forced run

- **WHEN** a forced run re-analysed 1,000 profile prompts and the user runs the same forced import again
- **THEN** the run SHALL report those 1,000 prompts as already done
- **AND** it SHALL send none of them to the model

#### Scenario: A rerun without force

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs the same import without `--force`
- **THEN** the run SHALL report 1,000 profile prompts as already done
- **AND** it SHALL send none of them to the model

#### Scenario: A forced dry run

- **WHEN** the ledger records 1,000 profile prompts as done and the user runs the import with `--force --dry-run`
- **THEN** the report SHALL show 1,000 profile prompts it would record
- **AND** the prompt store and the ledger SHALL stay unchanged

#### Scenario: A prompt still in the store

- **WHEN** a forced import reaches a prompt that is still in the prompt store and marked as learned
- **THEN** the prompt SHALL be marked as waiting again
- **AND** the store SHALL still hold one copy of that prompt

#### Scenario: Using the dedicated profile action for all hosts

- **WHEN** the user chooses Re-analyse chat history, selects All hosts, previews, and confirms
- **THEN** the grouped import SHALL analyse eligible profile prompts sequentially under the existing force rule
- **AND** stored project memories SHALL remain unchanged

### Requirement: A workflow is a repeatable sequence of concrete steps

The profile analysis prompt SHALL define a workflow as a sequence of at least 3 concrete steps that the user repeats across tasks. The prompt SHALL tell the model not to describe the user's personality, style, or general habits as a workflow. The system SHALL drop an analysed workflow that has fewer than 3 non-empty steps before it is merged into the profile.

#### Scenario: A workflow with enough steps

- **WHEN** the model returns a workflow with 4 steps
- **THEN** the workflow SHALL be merged into the profile

#### Scenario: A workflow with too few steps

- **WHEN** the model returns a workflow with 2 steps
- **THEN** the workflow SHALL NOT be added to the profile
- **AND** the preferences and patterns of the same reply SHALL still be merged

### Requirement: A workflow merges only with a close match

A new workflow SHALL merge into an existing workflow only when their similarity is in the strong band. A weaker similarity SHALL create a separate workflow. A merge SHALL NOT fold other existing workflows into the matched one.

#### Scenario: A weak match

- **WHEN** a new workflow has a similarity below the strong threshold to every existing workflow
- **THEN** the profile SHALL gain one new workflow
- **AND** the frequency of every existing workflow SHALL stay the same

#### Scenario: A strong match

- **WHEN** a new workflow has a similarity at or above the strong threshold to one existing workflow
- **THEN** that workflow's frequency SHALL increase by 1
- **AND** no other workflow SHALL be removed or changed

### Requirement: A workflow keeps its own wording and steps

The system SHALL NOT rewrite a workflow description into a general description of the user's behaviour. A match SHALL NOT replace the steps of an existing workflow with a shorter list.

#### Scenario: A repeated workflow at a milestone frequency

- **WHEN** a workflow reaches a frequency that triggers a description rewrite for preferences and patterns
- **THEN** the workflow description SHALL stay unchanged

#### Scenario: A match with fewer steps

- **WHEN** a new workflow matches an existing workflow of 7 steps and has 4 steps
- **THEN** the existing workflow SHALL keep its 7 steps

### Requirement: A terminal profile run warms the embedding service first

A terminal history import that learns the profile, and the terminal `profile-catch-up` run, SHALL warm the embedding service before the first prompt batch. If the warm-up fails, the import SHALL still run and SHALL print a warning that names the reason. A dry run, an import that skips the profile, and a catch-up run that makes no model call SHALL NOT warm the service.

#### Scenario: A profile-only import

- **WHEN** a user runs a terminal history import with `--skip-memories`
- **THEN** the embedding service SHALL be warmed before the first prompt batch is analysed
- **AND** the findings of each batch SHALL be merged into the profile and not held in the cold buffer

#### Scenario: The warm-up fails

- **WHEN** the embedding server cannot be reached at the start of a terminal import
- **THEN** the import SHALL continue
- **AND** a warning SHALL name the reason

#### Scenario: A terminal catch-up run

- **WHEN** a user runs `profile-catch-up --yes`
- **THEN** the embedding service SHALL be warmed before the first backlog batch is analysed

### Requirement: Categories that differ only in spelling are one category

The profile SHALL give each preference and pattern category a match key: trimmed, lower case, with `_`, `-` and runs of spaces turned into a single space. Two labels with the same key SHALL be the same category. This SHALL hold for items stored before this rule. The merge SHALL compare categories by key.

#### Scenario: A new item meets an old spelling

- **WHEN** a stored preference has the category "communication_style" and a new preference has the category "Communication style" with a similarity in the same-category strong band
- **THEN** the two SHALL merge as items of the same category

#### Scenario: Different categories stay different

- **WHEN** a stored item has the category "tooling" and a new item has the category "testing"
- **THEN** the cross-category thresholds SHALL apply

### Requirement: One category has one visible label

When a profile is saved, the system SHALL rewrite every category of preferences and patterns that shares a key to one visible label. An existing spelling without `_` or `-` SHALL take priority over spellings with those separators, regardless of item count. Among spellings with the same separator preference, the label SHALL be the spelling used by the most items across preferences and patterns. A tie SHALL go to a spelling that starts with a capital, then to the spelling seen first. The label SHALL then be tidied as described below. The rewrite SHALL cover learning, the manual edit on the Settings page, and the AI cleanup. It SHALL NOT change any other field, and it SHALL NOT merge, remove, or reorder items. Workflows have no category and SHALL be left alone.

#### Scenario: The most used spelling wins

- **WHEN** a profile holds 3 items with the category "Communication Style" and 2 items with "Communication style"
- **THEN** all 5 items SHALL have the category "Communication Style"

#### Scenario: A tie

- **WHEN** a profile holds 2 items with "communication_style" and 2 with "Communication style"
- **THEN** all 4 items SHALL have the category "Communication style"

#### Scenario: The stored spelling is sticky

- **WHEN** a profile holds 50 items with "Communication style" and the model returns one new item with "communication_style"
- **THEN** the new item SHALL be stored with the category "Communication style"

#### Scenario: A readable label survives a frequent slug

- **WHEN** a profile holds 5 preferences with "git-workflow" and one pattern with "Git workflow"
- **THEN** all 6 items SHALL use "Git workflow"
- **AND** a second canonicalisation SHALL change nothing

#### Scenario: An underscore spelling cannot displace a readable label

- **WHEN** a profile holds 5 patterns with "writing_standards" and one preference with "Writing standards"
- **THEN** all 6 items SHALL use "Writing standards"

#### Scenario: Hyphens without a readable alternative

- **WHEN** the only spelling for a key is "Anti-over-engineering"
- **THEN** that spelling SHALL stay unchanged

#### Scenario: A manual edit

- **WHEN** a user changes one item's category on the Settings page to "communication style" and other items in the profile use "Communication style"
- **THEN** the item SHALL be stored with the category "Communication style"

### Requirement: A label is tidied before it is stored

Before a label is stored, the system SHALL turn `_` into a space, collapse runs of spaces, and trim the ends. If the label holds no capital letter, the system SHALL capitalise its first letter. A label that already holds a capital letter SHALL keep its capitals. A blank label SHALL become "General". The category `explicit` SHALL stay `explicit`, and no other spelling of that key (such as "Explicit") SHALL replace it, whatever the counts.

#### Scenario: A slug

- **WHEN** the model returns the category "writing_standards"
- **THEN** the stored category SHALL be "Writing standards"

#### Scenario: An acronym

- **WHEN** the model returns the category "UI/UX"
- **THEN** the stored category SHALL be "UI/UX"

#### Scenario: A proper name

- **WHEN** the model returns the category "OpenSpec conventions"
- **THEN** the stored category SHALL be "OpenSpec conventions"

#### Scenario: A hyphen inside a longer label

- **WHEN** the model returns the category "Anti-over-engineering"
- **THEN** the stored category SHALL be "Anti-over-engineering"

#### Scenario: A blank category

- **WHEN** an item has an empty category
- **THEN** the stored category SHALL be "General"

#### Scenario: The explicit category

- **WHEN** an item has the category "explicit"
- **THEN** the stored category SHALL stay "explicit"

#### Scenario: A capitalised variant of the explicit category

- **WHEN** items hold both "explicit" and "Explicit", in any counts, across preferences and patterns
- **THEN** every one of those items SHALL be stored as "explicit"

### Requirement: The profile prompt lists the existing categories

When a profile already exists, the profile analysis prompt of every host SHALL list the visible labels of the existing preference and pattern categories and SHALL tell the model to use these exact names when an observation fits. The list SHALL show the item count of each label, put the most used first, and hold at most 40 labels for each type. When no profile exists, the prompt SHALL NOT hold a category list. Every host SHALL produce the same list text for the same profile.

#### Scenario: Spelling variants in one entry

- **WHEN** a profile holds 3 preferences with the category "communication_style" and 2 with "Communication style"
- **THEN** the list SHALL show one label with a count of 5

#### Scenario: A long category list

- **WHEN** a profile holds preferences in 100 distinct categories
- **THEN** the preference list SHALL show the 40 most used categories

#### Scenario: The first run

- **WHEN** no profile exists
- **THEN** the prompt SHALL hold no category list

#### Scenario: Hosts agree

- **WHEN** the same profile is analysed through the shared prompt and through the OpenCode prompt
- **THEN** both prompts SHALL hold the same category list text

### Requirement: A repair command applies the label rules to the stored profile

The command `om-memory-system profile-normalise-categories` SHALL apply the label rules to every stored preference and pattern. It SHALL print each rename (old label, new label, item count) and the number of distinct categories before and after. It SHALL change nothing without `--yes`, and nothing on `--dry-run`. A saved change SHALL appear in the profile changelog, so the previous state can be restored. A second run SHALL report 0 changes and SHALL NOT write a changelog entry.

#### Scenario: A preview

- **WHEN** a user runs the command without `--yes`
- **THEN** the command SHALL list the renames and the counts
- **AND** the stored profile SHALL stay unchanged

#### Scenario: A confirmed run

- **WHEN** a user runs the command with `--yes` on a profile with the categories "communication_style" and "Communication style"
- **THEN** both items SHALL have the same category
- **AND** the number of items SHALL stay the same
- **AND** the profile changelog SHALL hold a new entry for the change

#### Scenario: A second run

- **WHEN** a user runs the command with `--yes` again
- **THEN** the command SHALL report 0 changes
- **AND** it SHALL NOT write a new changelog entry

### Requirement: A profile save never overwrites a newer version

Every save of a stored profile SHALL carry the version that the writer read. The save SHALL fail without changes when the stored version differs. This SHALL hold for every host, every learning path, background steps and user actions. A background step whose save fails SHALL skip that save and log an outcome code. A user action whose save fails SHALL report that the profile changed and ask the user to try again.

#### Scenario: Two writers read the same version

- **WHEN** two writers read profile version 40 and both try to save
- **THEN** the first save SHALL store version 41
- **AND** the second save SHALL fail and leave version 41 unchanged

#### Scenario: Confidence decay meets a newer version

- **WHEN** confidence decay reads version 40 and another writer saves version 41 before decay saves
- **THEN** decay SHALL NOT save
- **AND** the log SHALL record an outcome code without profile content

#### Scenario: A web edit meets a newer version

- **WHEN** a user edits a profile item in the web app and learning saves a new version first
- **THEN** the edit SHALL fail with a message to try again
- **AND** the stored profile SHALL keep the version that learning wrote

### Requirement: Learning merges again after a save conflict

When a learning save fails because the stored version changed, learning SHALL load the stored profile, merge the same analysis result into it, and save again with the new version. It SHALL NOT call the analysis model again. It SHALL make at most three save attempts. When all three fail, the profile SHALL stay unchanged, the analysed prompts SHALL stay unanalysed for a later run, and live learning in that process SHALL wait 10 minutes. Every host and the backlog catch-up SHALL behave the same.

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

With `userProfilePromptDetail` set to `full`, the default, the model input SHALL hold the numbered prompts, a summary of the current profile, the analysis guidelines and the examples. With `prompts-only`, it SHALL hold only the numbered prompts. In both cases the input SHALL be cut to `userProfileMaxContextBytes` bytes of UTF-8 text, without splitting a character, and SHALL contain the truncation marker between the kept head and tail when it was cut.

#### Scenario: A first profile

- **WHEN** no profile exists and the setting is `full`
- **THEN** the input SHALL hold the prompts, the guidelines and the examples, and no profile summary

#### Scenario: A long batch

- **WHEN** the batch is 50 KB and `userProfileMaxContextBytes` is 32768
- **THEN** the input SHALL be at most 32768 bytes and SHALL contain the truncation marker

#### Scenario: Prompts-only input with the check of older items

- **WHEN** `userProfilePromptDetail` is `prompts-only` and the check of older items runs
- **THEN** the input SHALL hold the numbered prompts and the check task, and nothing else

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

#### Scenario: The host model replies with bad JSON

- **WHEN** the Pi or OpenCode host model replies with text that is not JSON, or JSON that does not match the profile schema, and the external API is fully configured
- **THEN** the reply SHALL count as a failed call and the pass SHALL use the external API
- **AND** the host SHALL show the warning "Using fallback provider"

#### Scenario: The warning notice never returns

- **WHEN** the host model fails and the warning notice never returns
- **THEN** the pass SHALL still call the external API

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

### Requirement: A saved batch is never learned twice

A profile save SHALL record the ids of the prompts it took in, in the same write as the profile. A live pass or catch-up run SHALL NOT send a recorded prompt to the model again: it SHALL mark the prompt as learned instead. This SHALL hold after a restart and in another process, for every host. A successful mark SHALL remove the record.

#### Scenario: The mark fails and the process restarts

- **WHEN** a pass saves the profile, every mark of its prompts fails, and the process restarts
- **THEN** the next pass that takes those prompts SHALL make no model call for them
- **AND** the profile SHALL be saved once for that batch
- **AND** the prompts SHALL be marked as learned once the prompt store works

### Requirement: Profile learning settings are global only

`userProfileWithoutEmail`, `userProfileDecayBeforeMerge`, `userProfilePromptDetail`, `userProfileDuringCatchUp`, `userProfileValidationEnabled` and `showUserProfileToasts` SHALL be read from the global config only. A project config value for any of them SHALL be ignored and SHALL be logged once with the key name. An invalid value SHALL be reported as a config problem that names the key and the accepted values.

#### Scenario: A project tries to turn on decay

- **WHEN** a project config sets `userProfileDecayBeforeMerge` to `true` and the global config does not
- **THEN** learning in that project SHALL NOT decay
- **AND** the log SHALL name the ignored key

#### Scenario: An invalid value

- **WHEN** the global config sets `userProfilePromptDetail` to `"short"`
- **THEN** the config problem SHALL name the key and the values `full` and `prompts-only`

### Requirement: A catch-up run starts only after the user confirms its cost

Both SHALL first report the number of waiting prompts and the number of profile analysis calls, leaving out trivial prompts, which are skipped without a model call, and SHALL start only after the user confirms (on the page) or passes `--yes` (in the terminal). The page SHALL explain that these are prompts already inside OMMS, that completed history is not re-analysed by this action, and that additional matching, deduplication, or retry calls can occur.

#### Scenario: Starting from the page

- **WHEN** 2,600 non-trivial prompts wait and the user presses **Analyse waiting prompts**
- **THEN** the page SHALL ask to confirm 52 profile analysis calls
- **AND** on confirm it SHALL show progress until the run ends
- **AND** it SHALL identify preferences, patterns, and workflows as the outputs

### Requirement: The terminal and the page control a catch-up run

The terminal command SHALL accept the same model options as the history imports (`--provider`, `--model`, `--api-url`, `--api-key-env`) and `--dry-run`. The page SHALL show progress and SHALL offer **Pause** and **Resume**.

#### Scenario: Another model from the terminal

- **WHEN** the user runs `om-memory-system profile-catch-up --provider openai-chat --model other-model --api-url <url> --api-key-env KEY --yes`
- **THEN** the run SHALL use that model and SHALL NOT change the saved config

### Requirement: Only one catch-up run works at a time

Only one catch-up run SHALL run at a time across every process. A live pass SHALL run beside it or pause, as `userProfileDuringCatchUp` says, and the two SHALL never take the same prompt. A second start inside the same web app while its own run is active SHALL be refused with `409`.

#### Scenario: A live pass during a run

- **WHEN** a catch-up run is active and `userProfileDuringCatchUp` is not set
- **THEN** a live pass SHALL run on prompts that the catch-up run has not claimed

### Requirement: A newer catch-up run takes over from an older one

When a run starts while another run in a different process holds the run record, the newest run SHALL take over: the older run SHALL stop before its next batch with the message that a newer run took over, and the newer run SHALL wait until the older run's current batch ends before it sends its first batch, so no batch is sent twice. A run record not refreshed for 10 minutes SHALL expire.

#### Scenario: A terminal run takes over from the page

- **WHEN** a catch-up run from the page is sending a batch and the user starts `om-memory-system profile-catch-up --yes`
- **THEN** the terminal run SHALL wait until that batch ends, then continue with the prompts still waiting
- **AND** the page SHALL show that a newer run took over, and SHALL send no more batches

#### Scenario: A run that crashed

- **WHEN** a run stopped without clearing its run record and 10 minutes have passed since the record was refreshed
- **THEN** a new run SHALL start without waiting
