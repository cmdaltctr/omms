# Design

## Context

See proposal.md for the motivation. Current state:

- Both hosts call `captureConversation()` in `src/core/capture.ts` with a host-neutral `CaptureWorkUnit`. A failure there sets a reason code (`call-error`, `empty-text`, `truncated`, `invalid-json`, `schema-mismatch`, `persist-error`) and throws.
- OpenCode (`src/services/auto-capture.ts`) retries up to `autoCaptureMaxRetries` times with 2 s and 4 s waits. Each failure increments `user_prompts.capture_attempts`. After the last try, the prompt row is never selected again.
- Pi (`src/adapters/pi/capture.ts`) tries once. It captures only the newest turn on each `agent_settled`, so a failed turn is lost after the next prompt.
- `capture_attempts` in `user-prompts.db` already stores one metadata record per attempt. `cleanup-service.ts` prunes it each day.
- Memories store `promptId` and `sourceEntryIds`, so the history importer already skips turns that live capture saved (`live-captured`).
- The capture trace already redacts text with `stripPrivateContent` and `redactTraceText`.

## Goals / Non-Goals

**Goals:**

- Recover live captures that failed for a reason a retry can fix, with no user action.
- Keep stored conversation text small, cleaned, short-lived and outside project folders.
- Use one shared implementation for both hosts. Adapters only queue and trigger.

**Non-Goals:**

- Retrying history-import or profile-learning failures. The import ledger already handles import retries.
- A background daemon or timer that runs with no host open.
- A list of queued turns in the Web UI. The page shows a count and a **Retry now** button for each host.
- Changing OpenCode's existing quick retries within a turn.

## Decisions

### D1. Store the cleaned work unit, not a reference

The queue row holds the `CaptureWorkUnit` as JSON. A retry calls `captureConversation(unit, provider)` again.

- Alternative: store only session and turn IDs, and rebuild the turn from host history with the importer readers. Rejected. Finding one turn again in OpenCode's database or a Pi session file is the most complex part, and a deleted session breaks it.
- Cost: conversation text is stored outside memories. D4 and D5 limit that. The user accepted this policy change.

### D2. Classify failures into retryable and permanent

Add a pure function in its own module, `src/core/capture-retry-policy.ts`. It takes the failure reason code and the thrown error and returns `retryable` or `permanent`.

- Retryable: `call-error` with no HTTP status (network failure, DNS, connection reset, timeout, abort by timeout), `call-error` with HTTP 408, 429 or 5xx, and `persist-error` (a locked or busy local store).
- Permanent: `call-error` with any other 4xx status (bad key, bad request, unknown model), `empty-text`, `truncated`, `invalid-json` and `schema-mismatch`. Repeating the same input to the same model is unlikely to fix a bad reply, and each try costs money.
- The status comes from a new optional `httpStatus` field in the capture diagnostics. Providers set it when they know it. The OpenCode provider (`src/adapters/opencode/opencode-provider.ts`) already formats `res.status` through `src/adapters/opencode/opencode-diagnostics.ts`. The external API providers get the status from their fetch response.
- A 429 response with a `Retry-After` header sets the next try time to at least that value.

### D3. One table, shared by both hosts, drained per host

A new `capture_retry_queue` table in `user-prompts.db`, next to `capture_attempts`:

`id, host, session_id, turn_id, project_directory, work_unit (JSON), size_bytes, created_at, attempts, next_attempt_at, last_reason, claimed_until`

- `(host, turn_id)` is unique. Queueing the same turn twice updates the existing row.
- Each host drains only its own rows. The retry uses the same host's current model choice, so a Pi turn is never summarised by the OpenCode model.
- A drain claims one row at a time: `UPDATE … SET claimed_until = now + 5 min WHERE id = ? AND (claimed_until IS NULL OR claimed_until < now)`. Two processes can then never retry the same turn. A crashed process releases its claim when the lease runs out.
- Alternative: a JSON Lines file as Hindsight uses. Rejected. OMMS already has a store with multi-process safety, and a table gives atomic claims.

### D4. Clean before storing, and cap sizes

- Before a row is written, the prompt, replies and tool-call text go through `stripPrivateContent` and the trace redaction rules. A turn that is fully private is not queued.
- A row over 256 KB of JSON is not queued. OMMS logs its size and session ID only. A manual history import can still recover it.
- The queue holds at most 20 MB in total per store. A new row that would pass the cap deletes the oldest rows first.

### D5. Delete rows on every final outcome

- Success: delete the row. For OpenCode, also mark the `user_prompts` row captured and link the memory, the same as a live success.
- Extractor returns `skip`: delete the row. For OpenCode, delete the prompt row, the same as a live skip.
- Permanent failure: delete the row.
- Age: `cleanup-service.ts` deletes rows older than `captureRetryRetentionHours`. Each drain also skips and deletes expired rows, so rows expire on time even if cleanup has not run.

### D6. Back-off schedule and triggers

- The waits after attempts 1 to 4 are 1 min, 5 min, 30 min and 2 h. After that the wait is 12 h. Each wait gets up to 20 % random jitter. There is no attempt limit; retention ends it.
- Triggers:
  - Pi: `session_start`, and after `capturePiSettledWorkUnit` returns `captured`.
  - OpenCode: the `session.created` event, and after `performAutoCapture` saves a memory.
- A drain runs in the background with a guard so only one drain runs per process. It handles due rows oldest first, one at a time. It stops at the first retryable failure. That failure sets the row's next time. Each trigger therefore costs at most one failed call while the API is down.
- Every retry goes through `captureConversation`, so each retry writes one `capture_attempts` record as today.

### D7. Setting

- `captureRetryRetentionHours`: default 72, range 0 to 720. Values are rounded down to whole hours and clamped to the range. Hours give finer control than the day-based retention fields, because this data holds conversation text.
- 0 means off (D10).
- Global only. A project config value is ignored, the same as `captureTraceRetentionDays`, because it controls how long conversation text is kept.
- The Web UI edits it through the existing global-config writer and settings snapshot allow lists.
- The pure normalisation lives in `src/config.ts` next to the other retention fields. Tests that stub `../src/config.js` do not need the new key, because the queue module reads `CONFIG` through a parameter.

### D11. Pi makes the same quick retries as OpenCode

- Pi tries a turn up to `autoCaptureMaxRetries` times (default 3), with waits of 2 s and 4 s, the same as OpenCode. It queues the turn only after the last try fails with a retryable error.
- Pi retries any failure quickly, as OpenCode does. The retry classification applies only to the queue.
- The `running` guard stays set during the quick retries, so a new `agent_settled` event waits for them.

### D8. Queue failures never block capture

Writing, draining or pruning the queue catches its own errors, logs a code and continues. A failed queue write leaves the live capture outcome unchanged. A manual `memory` operation never waits for a drain.

### D9. Retry now

- The Settings page shows a **Retry now** button for each host. The server endpoint sets `next_attempt_at` to now for all of that host's rows.
- Each host registers its drain in its own process with a small registry in `src/services/`, modelled on `registerHostProfileModel` in `src/services/user-profile/profile-model.ts`. Shared code then never imports an adapter. The button follows the behaviour of backfill **Run now** in `src/importer/backfill-controls.ts`.
- Pi registers its drain in `session_start`. OpenCode registers it at plugin start in `src/adapters/opencode/backfill-startup.ts`, next to `registerOpencodeHostModels`.
- The standalone web app registers no host, so **Retry now** there always returns `scheduled`.
- If the host's drain is registered in the Web UI server's process, the endpoint starts a drain at once and returns `started`. The drain still stops at the first retryable failure.
- If it is not registered, the endpoint returns `scheduled`. The page says the turns retry at that host's next session start.
- If a drain for that host is already running, the endpoint returns `running` and starts nothing new.
- The button is disabled when the host has no waiting turns or the queue is off. The endpoint uses the same access control as other Settings changes.
- Alternative: retry through the external API from the server for either host. Rejected. A turn must use its own host's model choice (D3).

### D10. Turning the queue off

- With `captureRetryRetentionHours` set to 0, a retryable failure is not queued, and a drain deletes all rows and retries none.
- When the Settings page saves 0, the save handler deletes all waiting rows at once. It does not wait for the next drain or cleanup.
- Cleanup also deletes all rows while the value is 0. This covers a value set by editing the config file.

## Risks / Trade-offs

- [Queued text is readable on disk] → Clean it first (D4), keep it in `~/.omms/data` only, delete it within the retention period (D5), and record the policy in an ADR.
- [Paid retries against a broken API] → Only retryable errors are queued, a drain stops at the first failure, and waits grow to 12 h.
- [Wrong classification of an unknown error] → Unknown `call-error` without a status counts as retryable. Retention caps the cost of a mistake.
- [Model changes between failure and retry] → The retry uses the host's model choice at retry time. This matches what a manual import does.
- [A queued turn and a later manual import race] → Both use the same `promptId` and `sourceEntryIds`. The importer skips turns already captured. The drain claims its row, so it does not run twice.

## Migration Plan

- The table is created on first use with `CREATE TABLE IF NOT EXISTS`. No data migration.
- Rollback: an older version ignores the table. Deleting the table is safe.
