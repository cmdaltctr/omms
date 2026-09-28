## Why

When the capture model cannot be reached, OMMS loses that turn's memory. OpenCode tries 3 times in about 6 seconds and then gives up for good. Pi tries once, and the next prompt moves capture on to the newest turn. The only recovery is a manual history import, and auto-backfill does not cover turns after its cutoff. Users expect memory capture to work without them watching it.

## What Changes

- Add a capture retry queue in the OMMS store (`~/.omms/data`). When a live capture fails with an error that a retry can fix, OMMS saves a cleaned copy of the turn and tries it again later.
- Classify each failure before queueing. Queue network failures, timeouts, rate limits (HTTP 429) and server errors (HTTP 5xx). Do not queue bad keys, bad requests, bad model replies or private-only turns.
- Retry with growing waits (1 min, 5 min, 30 min, 2 h, then every 12 h). Try again at session start and after any successful live capture. Stop a retry pass at the first failure that a retry can fix.
- Remove `<private>` content and redact secrets before a turn is saved to the queue. Cap the size of each turn and of the whole queue.
- Delete a queued turn when its retry succeeds, when it fails with an error that a retry cannot fix, or when it is older than the new `captureRetryRetentionHours` setting.
- Add `captureRetryRetentionHours` to the global config. The default is 72 hours, the range is 0 to 720 whole hours, and project configs cannot change it.
- Setting `captureRetryRetentionHours` to 0 turns the queue off. OMMS queues nothing, runs no retries, and deletes turns that are already waiting.
- Add a **Retry now** button for each host in the Capture diagnostics section. It retries that host's waiting turns at once, or at the host's next session start when the host does not run in the Web UI server's process.
- Show the setting and the number of queued turns for each host in the Capture diagnostics section of the Web UI Settings page.
- Both hosts get the same behaviour. Pi gets the quick retries within the turn that OpenCode already makes: up to `autoCaptureMaxRetries` tries (default 3) with 2 s and 4 s waits. Each host queues the turn only after the last quick retry fails.
- **Policy change**: OMMS will store prompt and reply text outside memories for a limited time. Record this in an ADR and in the Security section of `CLAUDE.md`.

## Capabilities

### New Capabilities

- `capture-retry-queue`: how failed live captures are classified, cleaned, stored, retried, and deleted, on both hosts.

### Modified Capabilities

- `capture-diagnostics`: the tracing requirement says no prompt or reply text is written outside the memory store when tracing is off. It must allow the retry queue as a named exception.
- `web-settings`: the Capture diagnostics section gets a control for `captureRetryRetentionHours`, shows the number of queued turns, and has a **Retry now** button for each host.

## Impact

- Code: `src/core/capture.ts` (error classification), a new queue module in `src/services/`, `src/adapters/pi/` and `src/services/auto-capture.ts` (queue on failure, drain on triggers), `src/index.ts` (OpenCode drain trigger), `src/adapters/opencode/opencode-provider.ts` (`httpStatus`), `src/adapters/opencode/backfill-startup.ts` (OpenCode drain registration), `src/config.ts`, `src/services/cleanup-service.ts`, `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, the web settings API and `web/src/lib/components/settings/DiagnosticsSection.tsx` with its i18n strings.
- Storage: a new `capture_retry_queue` table in `user-prompts.db`. No change to existing tables.
- Docs: `docs/web-ui-settings.md`, `docs/configuration.md`, `docs/using-memory.md`, a new ADR in `docs/adr/`, and `CLAUDE.md` Security.
- No new dependencies.
