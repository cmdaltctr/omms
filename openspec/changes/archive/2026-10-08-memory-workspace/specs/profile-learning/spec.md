# Spec Delta

## MODIFIED Requirements

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
