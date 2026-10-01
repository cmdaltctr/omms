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

The Settings page SHALL offer **Catch up profile** and the package SHALL offer `om-memory-system profile-catch-up`. Both SHALL first report the number of waiting prompts and the number of model calls, leaving out trivial prompts, which are skipped without a model call, and SHALL start only after the user confirms (on the page) or passes `--yes` (in the terminal). The run SHALL analyse waiting prompts oldest first in batches of 50, with the saved external API by default. The terminal command SHALL accept the same model options as the history imports (`--provider`, `--model`, `--api-url`, `--api-key-env`) and `--dry-run`. Only one catch-up run SHALL run at a time across every process, and it SHALL NOT overlap a live pass. When a run starts while another run in a different process holds the run record, the newest run SHALL take over: the older run SHALL stop before its next batch with the message that a newer run took over, and the newer run SHALL wait until the older run's current batch ends before it sends its first batch, so no batch is sent twice. A run record not refreshed for 10 minutes SHALL expire. A second start inside the same web app while its own run is active SHALL be refused with `409`. The page SHALL show progress and SHALL offer **Pause** and **Resume**. A failed batch SHALL stop the run with its reason code, and the next run SHALL continue from the prompts still waiting.

#### Scenario: Starting from the page

- **WHEN** 2,600 prompts wait and the user presses **Catch up profile**
- **THEN** the page SHALL ask to confirm 52 model calls
- **AND** on confirm it SHALL show progress until the run ends

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
