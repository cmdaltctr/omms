# Tasks

## 1. Core types and classification

- [x] 1.1 Add `CaptureAttemptDiagnostics` (fields, outcome, reason code union) and the optional `diagnostics` field on `CaptureSummaryRequest` in `src/core/host.ts`; verify with `bun run typecheck` and `bun test tests/host-neutral-capture-boundary.test.ts`
- [x] 1.2 Add `classifyCaptureReply` and stop-reason normalization to `src/core/extraction.ts`, following the spec's reason order; verify with new cases in `tests/core-extraction.test.ts` for reasoning-only replies (`empty-text`), a `length` stop with cut-off JSON (`truncated`), prose (`invalid-json`), `{"summary":"","type":"feature"}` (`schema-mismatch`), and a valid skip (`null`)

## 2. Diagnostics service

- [x] 2.1 Move the log path helpers to `src/services/log-path.ts` and export `getLogDirPath()` (a new export on `logger.ts` would break the many tests that stub it with only `log`); verify with `bun test tests/logger-path.test.ts`, including a case where `OMMS_LOG_FILE` moves the directory
- [x] 2.2 Create `src/services/capture-diagnostics.ts` with `emitCaptureAttempt(diagnostics, config)`, which writes one metadata-only log record; verify with a new `tests/capture-diagnostics.test.ts` asserting the record's field names and that a prompt and reply containing a fake API key do not appear anywhere in the log output
- [x] 2.3 Add `redactTraceText(text, config)`: `stripPrivateContent`, then configured secrets, then key and token regexes; verify with tests covering `<private>` text, each regex family, a configured `memoryApiKey` value, and ordinary text left unchanged
- [x] 2.4 Add `writeTraceEntry` (daily `capture-YYYY-MM-DD.jsonl`, directory `0700`, file `0600`, `schemaVersion: 1`, one append per entry, failures caught and logged without content); verify with tests for file permissions, one parseable JSON line per attempt, and a read-only directory that leaves the capture outcome unchanged
- [x] 2.5 Add `pruneTraces(config, now)` that deletes only matching file names older than `captureTraceRetentionDays`; verify with tests using fixed dates, including a file that does not match the pattern and must be kept

## 3. Config

- [x] 3.1 Add `captureTrace` (default `false`) and `captureTraceRetentionDays` (default `7`, minimum `1`) to `src/config.ts`, with commented entries in the config template; verify with `bun run typecheck` and a config test for the defaults
- [x] 3.2 Ignore a project-level `captureTrace: true` and log that it was ignored, while a project-level `false` wins; verify with config tests for global on/project off, global off/project on, and global on/project unset

## 4. Pipeline

- [x] 4.1 In `captureConversation` (`src/core/capture.ts`), create the collector, time the attempt, set outcome `saved`/`skipped`/`failed` (including `persist-error`), and emit in `finally`, writing a trace only when `captureTrace` is on; verify with tests that a saved, a skipped, and a thrown attempt each emit exactly one record and that no trace file appears when tracing is off
- [x] 4.2 Run `pruneTraces` once at startup in the OpenCode plugin and the Pi extension; verify with a test per host that old trace files are removed while tracing is off
- [x] 4.3 Confirm history imports emit records with source type `history-import` through `src/importer/importer.ts`; verify with a test in the importer suite

## 5. Extraction paths

- [x] 5.1 Pi bridge (`src/adapters/pi/provider.ts`): record provider, model, `stopReason`, block types, prompts, and raw reply; set the reason from `classifyCaptureReply` or `call-error`; remove the old "not a valid capture summary" log line; verify with `tests/pi-extraction.test.ts` cases for a reasoning-only reply, a `length` stop, and an `error` stop
- [x] 5.2 Add optional `stopReason` to `ToolCallResult` and fill it in the four external API providers; verify with a provider test per provider that a length stop is reported
- [x] 5.3 Add an optional `onReply` callback to `generateStructuredOutput` that exposes the assistant `finish` value and raw structured output before parsing; verify with an OpenCode provider test that the callback fires and that existing callers behave the same
- [x] 5.4 OpenCode summary (`src/adapters/opencode/auto-capture-summary.ts`): fill the collector on the host-model path and the external API path, map errors to reason codes, and remove the old log line; verify with a new `tests/opencode-capture-diagnostics.test.ts` (the conversation test covers only the conversation adapter) with cases for no structured output, a schema failure, an API failure, and a length stop
- [x] 5.5 Move `tests/capture-reply-log.test.ts` assertions from the removed log line to the new diagnostics record, keeping the check that no reply text is logged; verify with `bun test tests/capture-reply-log.test.ts`
- [x] 5.6 Add a parity test that runs the Pi, OpenCode host-model, and external API paths with fake models and asserts identical record field names; verify with `bun test` on that file

## 6. Docs and rules

- [x] 6.1 Document the diagnostics record, reason codes, `captureTrace`, `captureTraceRetentionDays`, the project rule, the trace location, and the warning that traces can contain conversation content in `docs/configuration.md`, with short links from `docs/pi-adapter.md` and `docs/opencode-adapter.md`; verify with `bun run check`
- [x] 6.2 Update the Security section of `AGENTS.md` (which `CLAUDE.md` links to) and matching text in `CONTRIBUTING.md` to "always log metadata; log prompts and replies only when the user turns on `captureTrace`"; verify by reading the diff
- [x] 6.3 Add a TDR in `docs/tdr/` for the two-tier logging decision and add it to `docs/tdr/README.md`; verify with `bun run check`

## 7. Verification

- [x] 7.1 Run `bun run ci:local` and confirm it passes
- [x] 7.2 Manually run one Pi session and one OpenCode session with `captureTrace` on, confirm one log record and one trace entry per attempt with no private text, then turn it off and confirm no new trace entries

## 8. Fixes found during verification

- [x] 8.1 Stop provider error logs from quoting model replies (`openai-chat-completion.ts` response and tool arguments, `anthropic-messages.ts` tool input, JSON `SyntaxError` messages in all three providers); verify with `tests/provider-log-redaction.test.ts`, which fails without the fix
- [x] 8.2 Ask the Pi model for a single JSON object, since the Pi bridge gets plain text back; verify with `tests/pi-extraction.test.ts` and a live Pi run that saves
- [x] 8.3 Map OpenCode 2.0.14's `session.execution.succeeded` (and an idle `session.status`) to `session.idle`; verify with `tests/v2-plugin-adapter.test.ts`, which fails without the fix, and a live OpenCode v2 run that saves
- [x] 8.4 Use the V2 plugin's session client for structured output when no server URL is known; verify with `tests/opencode-provider.test.ts`, which fails without the fix
