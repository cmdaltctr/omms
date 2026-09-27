# TDR-005: Log capture metadata always and full traces only on opt-in

**Date:** 2026-09-27
**Status:** Accepted
**Deciders:** OMMS maintainers
**Supersedes:** the logging part of TDR-002
**Tags:** capture, logging, privacy

## Context

From 2026-09-25 to 2026-09-27, 13 of 34 auto-capture attempts failed with `invalid summary payload`, on `zai/glm-5.3` and several `openai-codex` models. TDR-002 allowed only the provider, model, and reply length in the log. The installed release did not even log the length, and no release logged the stop reason or the reply's content block types. Nobody could tell whether a model returned no text, a cut-off reply, prose, or JSON with the wrong shape. The same rule also stopped the maintainer from studying how successful captures look.

### Root Cause Analysis (if debugging-driven)

The symptom was a failure with no cause. The cause was that the rule "never log reply text" was applied to metadata that contains no conversation content, and that no opt-in path existed for the text itself.

## Decision

Two tiers, both emitted from `captureConversation` in `src/core/capture.ts`, so there is exactly one record per attempt on every host and path:

1. **Always on:** one `Capture attempt` log record with host, source, session, path, provider, model, normalized stop reason, block types, prompt and reply sizes, duration, outcome, and a fixed reason code (`call-error`, `empty-text`, `truncated`, `invalid-json`, `schema-mismatch`, `persist-error`). Extraction paths fill a `CaptureAttemptDiagnostics` object on the summary request; `classifyCaptureReply` in `src/core/extraction.ts` picks the code.
2. **Opt-in:** with `captureTrace: true` in the global config, `src/services/capture-diagnostics.ts` appends the same fields plus the system prompt, user prompt, and raw reply to `traces/capture-YYYY-MM-DD.jsonl` next to the log. Text passes through `stripPrivateContent`, configured secrets, and key-format patterns first. The directory is `0700`, files `0600`, and files older than `captureTraceRetentionDays` (default 7) are pruned at startup and daily. A project config can turn tracing off, never on.

The same change closed three older leaks that broke the rule this TDR keeps: `openai-chat-completion.ts` logged up to 1,000 characters of a malformed response and 500 of the tool arguments, and `anthropic-messages.ts` logged 500 characters of the tool input. They now log sizes and top-level keys. `describeValidationError` in `base-provider.ts` also replaces JSON `SyntaxError` messages, which quote the start of the reply, in both logs and returned errors.

To surface stop reasons, `ToolCallResult` gained `stopReason`, and `generateStructuredOutput` gained an `onReply` callback that sees OpenCode's `finish` value and part types before parsing.

## Consequences

### Positive

- Each failure now has a cause code, per model, without any conversation text in the log.
- Maintainers can read full prompts and replies on their own machine when they choose.

### Negative

- Traces can hold conversation content that pattern redaction misses. The opt-in, the global-only switch, file permissions, and retention limit the exposure.
- Every capture adds about 300 bytes to the log.

### Neutral

- The two adapter-specific "model reply was not a valid capture summary" log lines are gone; the record replaces them.
- The log path helpers moved to `src/services/log-path.ts`, because many tests stub `logger.js` with only `log`.

## Alternatives Considered

| Option                                | Rejected Because                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Log reply text for everyone           | Anyone installing the package would store conversations in a plain-text log they never agreed to. |
| Log from each adapter                 | Adapters do not know whether the memory write succeeded, and three copies would drift apart.      |
| Return diagnostics from `summarize()` | A provider that throws returns nothing, and throwing is how the port defers a work unit.          |
| Let project configs turn tracing on   | A cloned repository could start recording someone's conversations.                                |

## How to Recognise / Handle This Again

1. A capture fails with a generic error.
2. Count reasons: `grep '"Capture attempt' ~/.omms/omms.log | grep -o '"reason":"[a-z-]*"' | sort | uniq -c`.
3. If the code is not enough, set `"captureTrace": true` in `~/.config/omms/omms.jsonc`, reproduce, and read `~/.omms/traces/`. Turn it off afterwards.

## Revisit Triggers

- A web UI that shows attempts (see the `web-settings` OpenSpec change), which moves records into the store.
- A secret leak found in a trace despite redaction.

## References

- `openspec/changes/capture-diagnostics/`
- [TDR-002](./002-accept-bare-skip-replies.md)
- [Configuration: Capture diagnostics](../configuration.md#capture-diagnostics)
