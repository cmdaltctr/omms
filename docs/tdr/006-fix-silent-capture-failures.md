# TDR-006: Fix silent capture failures on Pi and on OpenCode v2

**Date:** 2026-09-27
**Status:** Accepted
**Deciders:** OMMS maintainers
**Tags:** capture, pi, opencode-v2

## Context

The diagnostics from TDR-005 were checked live on 2026-09-27 and exposed two separate faults. Pi captures failed on about one attempt in three across models. OpenCode had no `Auto-capture memory persisted` line in any log since the v2 adapter shipped.

### Root Cause Analysis (if debugging-driven)

1. **Pi replies were not JSON.** The Pi model bridge gets plain text back, but the capture prompt never asked for JSON. `buildBoundedSummaryPrompt` received the schema only to size its budget, and the only format hints were the system prompt's Markdown `## Request` / `## Outcome` layout and the words `return type="skip"`. The trace showed `gpt-5.6-luna` answering `type="skip"\nsummary=""\ntags=[]` (reason `invalid-json`).
2. **OpenCode v2 never started capture.** OpenCode 2.0.14 ends a turn with `session.execution.succeeded` and emits neither `session.idle` nor `session.status`, as its `/api/event` stream showed. The V1 capture path runs only on `session.idle`, so it never ran.
3. **OpenCode v2 capture then could not call the model.** The native V2 plugin passes a session-capable client through `setV2Client`, but `generateStructuredOutput` used that client only when `createV2Client` had set `_useSdkTransport`. Otherwise it fell back to HTTP and failed with `v2 server base URL not initialized`.

## Decision

1. `buildCaptureReplyInstruction()` in `src/core/extraction.ts` tells the model to reply with one JSON object that matches `captureSummaryToolSchema`, shows the exact skip reply, and says where the Markdown summary goes. The Pi provider appends it to the prompt and counts it in the context budget. The shared analysis suffix now says `set "type" to "skip"` instead of `type="skip"`.
2. `toLegacyEvent` in `src/v2/legacy-client.ts` maps `session.execution.succeeded`, and `session.status` with an idle status, to `session.idle`.
3. `generateStructuredOutput` uses a session-capable client whenever no server URL is known, which is the native V2 case.

## Consequences

### Positive

- Live runs after the fix: Pi `gpt-5.6-luna` saved, and OpenCode v2 saved its first captures (`outcome: saved`, `Auto-capture memory persisted`).

### Negative

- The Pi prompt is about 700 characters longer.

### Neutral

- V1 OpenCode, which always has a server URL, keeps its HTTP path.

## Alternatives Considered

| Option                                       | Rejected Because                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Parse `key="value"` replies                  | Rewards a format we never asked for; other models invent other formats.      |
| Switch Pi capture to a different model       | The same failure appeared on GLM and Codex models; the prompt was the cause. |
| Poll session state instead of mapping events | More requests and more timing risk than one event mapping.                   |

## How to Recognise / Handle This Again

1. `Capture attempt` records show many `invalid-json` failures, or a host has no `Capture attempt` records at all.
2. Turn on `captureTrace` and read the reply; for a missing host, watch the host's event stream for the event that ends a turn.
3. Fix the prompt or the event mapping, and add a test with the observed reply or event.

## Revisit Triggers

- An OpenCode release that renames `session.execution.succeeded` again.
- A Pi model API that supports structured output, which would make the text instruction unnecessary.

## References

- [TDR-005](./005-two-tier-capture-diagnostics.md)
- `tests/pi-extraction.test.ts`, `tests/v2-plugin-adapter.test.ts`, `tests/opencode-provider.test.ts`
