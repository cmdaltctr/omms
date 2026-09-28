# Tasks

## 1. Setting and failure classification

- [x] 1.1 Add `captureRetryRetentionHours` to `src/config.ts` (default 72, whole hours, clamped 0 to 720, 0 means off, global only, listed in the commented config template). Verify with new cases in `tests/config.test.ts` for default, clamping, 0 and an ignored project value.
- [x] 1.2 Add an optional `httpStatus` field to capture diagnostics. Set it in `src/adapters/opencode/opencode-provider.ts` and the external API providers in `src/services/ai/providers/` when a response status is known. Verify with a provider test that a 503 reply sets `httpStatus` to 503.
- [x] 1.3 Add `src/core/capture-retry-policy.ts` with the retryable/permanent rule (design D2), the wait schedule with jitter and the `Retry-After` floor (D6). Verify with a unit test per reason code and status, including a failing check when the rule is broken.

## 2. Queue store

- [x] 2.1 Add `src/services/capture-retry-queue.ts` with the `capture_retry_queue` table in `user-prompts.db` (D3): enqueue with upsert on `(host, turn_id)`, claim with lease, reschedule, delete, count by host and prune by age. Verify with `tests/capture-retry-queue.test.ts` on a temporary store.
- [x] 2.2 Clean the work unit before storing it (D4): strip `<private>`, apply trace redaction, skip fully private turns, skip turns over 256 KB, and delete oldest rows past 20 MB. Verify with tests that stored JSON has no private text or sample key, and that the size limits hold.
- [x] 2.3 Verify two concurrent claims on the same row: only one succeeds, and an expired lease can be claimed again.

## 3. Shared drain

- [x] 3.1 Add a drain function that takes the host, a `CaptureSummaryProvider`, `CONFIG` and a clock. It deletes expired rows, retries due rows oldest first through `captureConversation`, stops at the first retryable failure, and deletes rows on success, skip or permanent failure (D5, D6). Verify with tests using a fake provider for each outcome.
- [x] 3.2 On an OpenCode success or skip, update the `user_prompts` row the same way live capture does. Verify with a test that the prompt row is marked captured and linked to the memory.
- [x] 3.3 Guard the drain so one runs per process, and catch every queue error with a logged code (D8). Verify with a test that a throwing queue does not change the live capture result.
- [x] 3.4 Add the queue to `cleanup-service.ts` pruning. Verify that a row older than the retention is gone after a cleanup run.
- [x] 3.5 Implement the off state (D10): no enqueue and no retries at 0, and a drain or cleanup run at 0 deletes all rows. Verify with tests for a failure at 0 and a drain at 0.

## 4. Host wiring (both hosts)

- [x] 4.1 Pi: queue the work unit when `capturePiSettledWorkUnit` fails with a retryable error. Start a drain on `session_start` and after a `captured` result. Verify with a test in the Pi capture test file.
- [x] 4.2 OpenCode: queue the work unit after the last quick retry fails with a retryable error. Start a drain on `session.created` and after a saved memory in `performAutoCapture`. Verify with a test in the auto-capture test file.
- [x] 4.3 Verify the boundary tests still pass: `tests/host-neutral-capture-boundary.test.ts`, `tests/pi-adapter-boundary.test.ts` and `tests/plugin-bundle-boundary.test.ts`.
- [x] 4.4 Verify that a history import skips a turn saved by a retry with reason `live-captured`.
- [x] 4.5 Pi: make up to `autoCaptureMaxRetries` quick tries (2 s and 4 s waits) before queueing, the same as OpenCode (D11). Verify with a Pi capture test that a failure followed by a success saves the turn and queues nothing.
- [x] 4.6 Document the Pi quick retries in `docs/using-memory.md` and in the `autoCaptureMaxRetries` entry of the docs.

## 5. Web UI

- [x] 5.1 Add `captureRetryRetentionHours` to the allow lists in `src/services/global-config-writer.ts` and `src/services/settings-snapshot.ts`. Verify with a new case in `tests/global-config-writer.test.ts`.
- [x] 5.2 Return queued-turn counts per host from the diagnostics API. Verify with an API handler test.
- [x] 5.3 Add the retention field and the queued counts to `DiagnosticsSection.tsx`, with strings in `web/src/lib/i18n/settings.ts` for every supported language. Verify with the web build and a check in the running Settings page.
- [x] 5.4 Add the retry registry in `src/services/`, modelled on `registerHostProfileModel`. Register Pi's drain in `session_start` and OpenCode's in `src/adapters/opencode/backfill-startup.ts`. Add a Retry now API endpoint that returns `started`, `scheduled` or `running` (D9). Make a save of 0 delete waiting rows before it returns (D10). Verify with API handler tests for each result, for access control, and for the save of 0.
- [x] 5.5 Add a **Retry now** button per host to `DiagnosticsSection.tsx`, disabled with no waiting turns or with the queue off, and show the `scheduled` message. Add strings for every supported language. Verify with the web build and a check in the running Settings page.

## 6. Documentation and policy

- [x] 6.1 Add an ADR in `docs/adr/` for storing cleaned failed turns for a limited time, and add it to `ADR_README.md`.
- [x] 6.2 Update the Security section of `CLAUDE.md` to name the retry queue as the one exception, with its cleaning and retention rules. Keep `CONTRIBUTING.md` in step if it repeats that rule.
- [x] 6.3 Update `docs/web-ui-settings.md` Capture diagnostics section: the retry retention field in hours, its default of 72, 0 to turn the queue off, the queued count, the **Retry now** button with its `scheduled` message, and that queued turns can hold cleaned conversation text.
- [x] 6.4 Update `docs/configuration.md` (new key in hours, 0 means off, global only, Web UI editable list) and `docs/using-memory.md` (what happens when capture fails and when to run a manual import).

## 7. Verification

- [x] 7.1 Run `bun run check` and `bun run ci:local`. Both pass.
- [x] 7.2 Manual check on both hosts: point the external API at an unreachable URL, make a turn, confirm one queued turn in the Settings page, restore the URL, press **Retry now** and confirm the memory is saved and the count returns to 0. Then set retention to 0 and confirm a new failure queues nothing.
