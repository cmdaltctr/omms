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

The Memory page's Profile learning section SHALL offer **Analyse waiting prompts** and the package SHALL offer `om-memory-system profile-catch-up`. Both SHALL first report the number of waiting prompts and the number of profile analysis calls, leaving out trivial prompts, which are skipped without a model call, and SHALL start only after the user confirms (on the page) or passes `--yes` (in the terminal). The page SHALL explain that these are prompts already inside OMMS, that completed history is not re-analysed by this action, and that additional matching, deduplication, or retry calls can occur. The run SHALL analyse waiting prompts oldest first in batches of 50, with the saved external API by default. The terminal command SHALL accept the same model options as the history imports (`--provider`, `--model`, `--api-url`, `--api-key-env`) and `--dry-run`. Only one catch-up run SHALL run at a time across every process, and it SHALL NOT overlap a live pass. When a run starts while another run in a different process holds the run record, the newest run SHALL take over: the older run SHALL stop before its next batch with the message that a newer run took over, and the newer run SHALL wait until the older run's current batch ends before it sends its first batch, so no batch is sent twice. A run record not refreshed for 10 minutes SHALL expire. A second start inside the same web app while its own run is active SHALL be refused with `409`. The page SHALL show progress and SHALL offer **Pause** and **Resume**. A failed batch SHALL stop the run with its reason code, and the next run SHALL continue from the prompts still waiting.

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
