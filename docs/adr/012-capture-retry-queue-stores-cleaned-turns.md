# ADR-012: Keep cleaned failed turns for a limited time to retry capture

**Date:** 2026-09-28
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

When the capture model cannot be reached, OMMS loses the memory for that turn. OpenCode tries 3 times in about 6 seconds and then stops. Pi tries once, and the next prompt moves capture on to the newest turn. The only recovery is a manual history import.

Until now, OMMS wrote prompt and reply text outside the memory store only in the opt-in capture trace. A retry needs the turn's text at a later time.

## Decision

OMMS keeps a cleaned copy of a turn whose live capture failed with an error that a retry can fix, and tries it again later.

- The copy goes in the `capture_retry_queue` table in `user-prompts.db`, in the OMMS data directory. It is never written inside a project folder.
- Only retryable failures are queued: a model call with no HTTP status (network failure or timeout), HTTP 408, 429 or 5xx, and a failed write to the local store. Bad keys, bad requests and bad model replies are not queued.
- Before a turn is stored, `<private>` text is removed and secrets are redacted with the capture trace rules. A fully private turn is not queued. A turn over 256 KB is not queued. The queue holds at most 20 MB and deletes the oldest turns first.
- A turn is deleted when its retry saves a memory, when the extractor skips it, when a retry fails for good, or when it is older than `captureRetryRetentionHours`.
- `captureRetryRetentionHours` is global only. It defaults to 72 hours, the range is 0 to 720, and 0 turns the queue off and deletes waiting turns.
- Each host retries only its own turns, with its current capture model choice. Shared code holds the queue and the drain. Each adapter only queues a failure and starts a pass.

## Consequences

### Positive

- A turn that failed while the API was down is saved later, with no user action.
- The same provenance (`promptId`, `sourceEntryIds`) is stored, so a later history import skips the turn as `live-captured`.

### Negative

- Cleaned conversation text is readable on disk for up to the retention period, even when tracing is off.
- A retry against a broken API costs a model call. A pass stops at the first retryable failure, and waits grow to 12 hours, so each trigger costs at most one failed call.

### Neutral

- An older OMMS version ignores the table. Deleting the table is safe.

## Alternatives considered

- **Store only session and turn IDs, and rebuild the turn from host history.** Rejected. Finding one turn again in OpenCode's database or a Pi session file is complex, and a deleted session breaks it.
- **A JSON Lines file.** Rejected. The store already has multi-process safety, and a table gives atomic claims.
- **Keep the current behaviour and rely on manual imports.** Rejected. Users expect capture to work without watching it.
