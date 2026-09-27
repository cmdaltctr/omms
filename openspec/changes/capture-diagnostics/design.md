# Design

## Context

For the motivation, see proposal.md, section Why.

Extraction runs on three paths:

1. **Pi model bridge** (`src/adapters/pi/provider.ts`). `ctx.modelRegistry.complete()` returns content blocks and a `stopReason` (`stop`, `length`, `toolUse`, `error`, `aborted`). `replyText()` keeps only `text` blocks. Today the code checks the stop reason only for `error` and ignores the block types.
2. **OpenCode host model** (`generateStructuredOutput` in `src/services/ai/opencode-provider.ts`). It returns parsed structured output and throws on errors. No raw text or stop reason reaches the caller.
3. **External API** (`AIProviderFactory` → `executeToolCall`). It returns `ToolCallResult` with parsed `data`. The providers see `stop_reason`/`finish_reason` internally but do not return them.

`captureConversation` in `src/core/capture.ts` is the only place that knows the final outcome (saved, skipped, or the memory write failed). Both live capture (`src/services/auto-capture.ts`) and history imports call it, once per attempt. Retries happen in the callers, and each retry calls it again.

Constraints from the repo: `src/core/` and `src/services/` must not import host SDKs. New pure logic should live in its own module and take `CONFIG` as an argument, because tests stub `src/config.js`.

## Goals / Non-Goals

**Goals:**

- One record per attempt, emitted from one place, with the same shape on every path.
- Classification that separates the likely causes of the current failures.
- A trace that cannot be switched on by a cloned repository and cannot outlive its retention period.

**Non-Goals:**

- Fixing the capture failures. That comes after the diagnostics show the cause.
- Tracing profile learning or other model calls outside the capture pipeline.
- Showing traces in the web UI, or shipping them anywhere off the machine.
- Guaranteeing that every secret is caught. Redaction reduces exposure; the opt-in and the retention period are the main controls.

## Decisions

### A collector on the summary request, emitted by `captureConversation`

`CaptureSummaryRequest` gets an optional `diagnostics` field: a mutable `CaptureAttemptDiagnostics` object that `captureConversation` creates. Extraction paths fill in the fields they can observe (path, provider, model, stop reason, block types, prompts, raw reply) and set a failure reason when they throw. `captureConversation` sets the outcome, times the attempt, and calls `emitCaptureAttempt(diagnostics, CONFIG)` in a `finally` block, so exactly one record is written whether the attempt succeeds, skips, or throws.

- Alternative: each adapter logs its own line. Rejected. The adapters do not know whether the memory write succeeded, and three copies would drift apart.
- Alternative: return diagnostics from `summarize()` next to the summary. Rejected. A provider that throws cannot return anything, and throwing is how the port defers a unit.

The failure reason travels on the collector, not in the error message. The existing error messages stay the same, so notifications and retry logic do not change.

### Classification is a pure function in `src/core/extraction.ts`

`classifyCaptureReply({ text, stopReason, blockTypes })` returns `null` for a valid summary or skip, or a reason code. It uses the order from the spec. `parseCaptureSummary` stays as it is; the Pi path calls the classifier only when parsing fails. The OpenCode host path maps "no structured output" to `empty-text` and a zod parse failure to `schema-mismatch`. The external API path maps `success: false` to `call-error`, and a parse failure of `JSON.stringify(result.data)` to `schema-mismatch`.

Stop reasons are normalized to `length` when a provider reports a length limit (`length`, `max_tokens`, `MAX_TOKENS`), so `truncated` works on every path that exposes a stop reason.

### Surfacing stop reasons from the OpenCode and external API paths

`ToolCallResult` gets an optional `stopReason`, and the four providers fill it from `stop_reason`, `finish_reason`, or the Gemini finish reason. `generateStructuredOutput` gets an optional `onReply` callback that receives the assistant `info` (its `finish` value and the raw structured output) before it parses. Both additions are optional, so existing callers are unaffected. When a path cannot observe a field, it stays absent, as the spec requires.

### Trace writing in a new `src/services/capture-diagnostics.ts`

This module owns `emitCaptureAttempt`, `redactTraceText`, `writeTraceEntry`, and `pruneTraces`. All of them take config as an argument.

- **Location:** `<log dir>/traces/capture-YYYY-MM-DD.jsonl`. The log directory comes from `getLogDirPath()` in a new `src/services/log-path.ts` (not `logger.ts`, because many tests stub `logger.js` with only `log`), so `OMMS_LOG_FILE` moves traces along with the log. The directory is created with mode `0700`, and files are created with mode `0600`.
- **Format:** one JSON object per line, written with a single `appendFileSync` per entry, so concurrent processes (Pi and OpenCode sharing a store) interleave whole lines. Each entry has `schemaVersion: 1` so a later analysis script can rely on its shape.
- **Redaction order:** first `stripPrivateContent`, then literal replacement of every resolved secret in config (`memoryApiKey`, `embeddingApiKey`, `webServerApiToken`, `webServerAuthPassword`), then regexes for common formats: `sk-…`, `sk-ant-…`, `ghp_`/`gho_`/`github_pat_`, `AKIA…`, `xox[bap]-…`, `AIza…`, JWTs, `Bearer <token>`, and `-----BEGIN … PRIVATE KEY-----` blocks. The marker is `[REDACTED]`, the same as `privacy.ts`.
- **Failures:** every trace step is wrapped in `try/catch`. A failure logs `"capture trace write failed"` with the error code only.

### Config and the project rule

New fields: `captureTrace?: boolean` (default `false`) and `captureTraceRetentionDays?: number` (default `7`, minimum `1`). The config merge at `src/config.ts:862` already separates the global and project files. After the merge, a project value of `captureTrace: true` is replaced by the global value and a log line records that it was ignored. A project value of `false` wins. This follows the existing `assertProjectRemoteProviderConfigIsSafe` pattern, but ignores the value instead of throwing, so a checked-in project file cannot break a user's setup.

- Alternative: a global allowlist of project paths. Rejected for now. Global on plus project off already covers "trace one repo and not another", and adding an allowlist later would not break anything.

### Retention

`pruneTraces` deletes files in the traces directory whose date in the file name is older than the limit. File modification times are not used. It runs once at plugin or extension startup whether tracing is on or off, and before the first write of each new day while tracing is on. It deletes only files that match `capture-YYYY-MM-DD.jsonl`.

### What replaces the old log lines

The two "model reply was not a valid capture summary" log lines are removed. The diagnostics record replaces them. The existing "Auto-capture memory persisted" and "Auto-capture skipped" lines stay, because other tools and people already look for them.

## Risks / Trade-offs

- [Regex redaction misses an unusual secret format] → Tracing is off by default, needs the global config, files are `0600`, and they are deleted after 7 days. The docs say plainly that a trace can contain conversation content.
- [Extra bytes in every omms.log line] → A record is about 300 bytes. At the current rate of about 30 attempts a day, that is small next to the existing log.
- [The OpenCode host path cannot see block types or raw text] → Those fields stay absent. The reason code still separates `empty-text` from `schema-mismatch`, and the trace records the structured output.
- [A collector passed by reference is easy to forget in a new extraction path] → A test runs each of the three paths with a fake model and checks that the emitted record has the same field names.

## Migration Plan

This is additive. No storage change and no config migration are needed. Rollback means reverting the change. Any trace files left behind are removed by the retention run of the next version that has it, or the user can delete `~/.omms/traces/` by hand, as the docs will say.

## Open Questions

- Does OpenCode's assistant `info` expose a `finish` value on every server version this adapter supports? If not, the OpenCode host path records no stop reason. That does not change the spec or the tasks.
