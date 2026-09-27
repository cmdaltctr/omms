# Proposal

## Why

Auto-capture fails on about one attempt in three (13 failures against 21 saves or skips in `~/.omms/` logs from 2026-09-25 to 2026-09-27), across `zai/glm-5.3` and several `openai-codex` models. The log line says only "invalid summary payload", so nobody can tell whether the model returned no text, a cut-off reply, prose, or JSON with the wrong shape. The current rule forbids logging reply text at all, which also blocks the maintainer from studying how captures succeed and fail.

## What Changes

- Every capture attempt, on both hosts, writes one structured diagnostics line to the OMMS log. The line holds only metadata: host, provider, model, stop reason, reply content block types, prompt and reply sizes, duration, and the outcome (`saved`, `skipped`, or `failed` with a reason code). It never holds conversation text. This is on for everyone.
- Failure reasons are classified into fixed codes: `call-error`, `empty-text`, `truncated`, `invalid-json`, `schema-mismatch`, and `persist-error`.
- A new opt-in setting, `captureTrace` (default `false`), writes a full trace for each attempt to a daily JSONL file under `~/.omms/traces/`. A trace adds the system prompt, the user prompt, and the raw reply to the diagnostics fields.
- Before a trace is written, text inside `<private>` tags is removed with `stripPrivateContent`, and strings that look like API keys or tokens are redacted, along with the configured secrets.
- Trace files older than `captureTraceRetentionDays` (default `7`) are deleted.
- `captureTrace` can be turned on only in the global config. A project config can set it to `false` to turn tracing off for that project, but a project config cannot turn it on, so a cloned repository cannot start recording someone's conversations.
- This covers live capture and history imports, because both go through the same capture pipeline.
- The Security rule in `CLAUDE.md` changes from "never log replies" to "always log metadata; log prompts and replies only when the user turns on `captureTrace`".

## Capabilities

### New Capabilities

- `capture-diagnostics`: the metadata record for each capture attempt, failure reason codes, the opt-in trace file, trace redaction, trace retention, and which config level can turn tracing on.

### Modified Capabilities

- `host-neutral-memory-core`: the requirement "Extraction tolerates skip replies and reports unparseable ones" currently forbids logging any part of the reply text. It changes to allow reply text in the opt-in trace file, and to point unparseable-reply reporting at the new diagnostics record.

## Impact

- `src/core/`: `host.ts` (a diagnostics collector on the summary request), `capture.ts` (emit one record per attempt with its outcome), `extraction.ts` (reply classification).
- `src/services/`: a new capture diagnostics module (record building, redaction, trace writing, retention), `privacy.ts` reuse, `logger.ts` (log directory for traces).
- `src/adapters/pi/provider.ts` and `src/adapters/opencode/auto-capture-summary.ts`: fill in the collector on every extraction path (Pi model bridge, OpenCode host model, external API).
- `src/config.ts`: `captureTrace` and `captureTraceRetentionDays`, the config template, and the project-config rule.
- Docs: `docs/configuration.md`, `docs/pi-adapter.md`, `docs/opencode-adapter.md`, a TDR, and the Security section of `CLAUDE.md`.
- No new dependencies. No storage schema change.
