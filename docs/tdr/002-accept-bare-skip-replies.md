# TDR-002: Accept bare skip replies and log unparseable capture output

**Date:** 2026-09-25
**Status:** Accepted
**Deciders:** Project maintainer
**Tags:** capture, diagnostics

## Context

A live capture with `zai/glm-5.3` returned `{"type":"skip"}`. The previous parser required `summary` and `tags` even when the model had chosen to skip, so the valid skip response was rejected. Invalid replies were also hard to diagnose because the log contained no bounded response sample.

### Root Cause Analysis

The parser applied the non-skip payload requirements to every response type. A bare skip therefore looked malformed even though a skipped unit needs no summary or tags.

## Decision

For `type: "skip"`, default a missing `summary` to `""` and missing `tags` to `[]`. For other types, require a non-empty summary. When parsing fails, log the provider, model id and first 500 characters of the reply. Redact the configured API key before truncating the sample. Keep the error available to the caller without logging an entire historical conversation.

## Consequences

### Positive

- Valid skip responses stop being treated as failures.
- A bounded reply sample helps diagnose malformed provider output.

### Negative

- The reply sample can contain user text. Keep `~/.omms/omms.log` private and review it before sharing.

### Neutral

- Existing non-skip responses still need a summary.

## Alternatives Considered

| Option                                   | Rejected Because                                          |
| ---------------------------------------- | --------------------------------------------------------- |
| Require the model to supply empty fields | Provider replies cannot be guaranteed to include them.    |
| Accept missing summaries on every type   | Allows unusable non-skip memories.                        |
| Log the complete response                | Risks excessive log size and exposure of private history. |

## How to Recognise / Handle This Again

1. If capture reports an invalid summary, check `~/.omms/omms.log` for the provider, model id and bounded reply sample.
2. If a bare `{"type":"skip"}` is rejected, rerun `bun test tests/core-extraction.test.ts` and inspect `parseCaptureSummary`.
3. If the reply is malformed, correct the provider configuration or prompt handling, then retry the capture.

## Revisit Triggers

Revisit when the capture schema changes or the log's privacy requirements change.

## References

- `src/core/extraction.ts`
- `src/adapters/pi/provider.ts`
- `tests/core-extraction.test.ts`
