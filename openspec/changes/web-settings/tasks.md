# Tasks

## 1. Prerequisites

- [ ] 1.1 Confirm the `capture-diagnostics` change is implemented and merged, or rebase this work on it; verify with `openspec status --change capture-diagnostics` showing all tasks done

## 2. Config writes and reload

- [ ] 2.1 Add `jsonc-parser` and a `writeGlobalConfigKeys(edits)` service that allows only the listed keys, validates the result, and writes through a temporary file and rename; verify with tests for keeping comments, key order, and other keys, rejecting unknown keys, rejecting invalid values with the file unchanged, and creating a missing file from the template
- [ ] 2.1a Make the writer target the config file OMMS loaded, and on a legacy-only install copy `opencode-mem.jsonc` to `~/.config/omms/omms.jsonc` before the first edit; verify with tests that the legacy file is unchanged, the new file keeps every key and comment, and the response asks for the notice
- [ ] 2.2 Add `refreshConfigIfChanged(directory)` and call it before each capture unit and profile-learning run on both hosts; verify with a test that changes `piModel` on disk and sees the next capture resolve the new model without a restart
- [ ] 2.3 Add `captureAttemptRetentionDays` (default `30`, minimum `1`) to `src/config.ts` and the template; verify with a config defaults test

## 3. Attempt store

- [ ] 3.1 Add the `capture_attempts` table and its migration, and insert a row from `emitCaptureAttempt` without prompt or reply text; verify with a store test that a saved, skipped, and failed attempt each produce one row, that no text column exists, and that an insert failure leaves the outcome unchanged
- [ ] 3.2 Delete rows older than `captureAttemptRetentionDays` in the cleanup service; verify with a cleanup test using fixed dates
- [ ] 3.3 Add a query service for rates by host and model, counts by reason, and recent attempts over a time range; verify with tests on seeded rows

## 4. Settings API

- [ ] 4.1 Add the mutation guard (origin check, token or Basic Auth when not on loopback, JSON content type) and the `captureTrace`-over-network refusal; verify with web-server tests for a foreign origin, a form post, a non-loopback request without a token, and tracing turned on over `0.0.0.0` without Basic Auth
- [ ] 4.2 `GET` and `PATCH /api/settings` with value sources and secret status only; verify with tests that no secret value appears in any response and that the project override is reported
- [ ] 4.3 `GET /api/settings/models` for OpenCode (connected providers) and Pi (dynamic SDK load with fallback); verify with tests for a listed model set and for `available: false` when the Pi SDK import fails
- [ ] 4.4 `GET /api/settings/diagnostics` and the trace list, read, and delete endpoints with a strict file-name pattern; verify with tests that path traversal names are rejected
- [ ] 4.4a `GET /api/settings/log` reading at most the last 256 KB of the log with a line limit and `filter=capture`; verify with tests for the filter, the line limit, a missing log file, and that a `path` query parameter is ignored
- [ ] 4.5 `POST /api/settings/health` with every check from the spec and optional model test calls with a fixed prompt; verify with tests for pass, warn at over 20% failures, and a failing model test whose error has the key removed

## 5. Imports from the page

- [ ] 5.1 Add the `"web"` import surface and turn structured page options into the shared parser's input; verify with a test that the page options and the equivalent CLI flags produce the same parsed options
- [ ] 5.2 Add an optional `AbortSignal` to `runHistoryImport`, checked between units; verify with an importer test that cancels mid-run and a rerun that imports only the remaining units
- [ ] 5.3 Add the job endpoints (start, current, cancel) with one job slot and model choice (OpenCode model or external API); verify with tests for a refused second job, a dry run that makes no model calls, and ledger reuse after a CLI import

## 6. Web UI

- [ ] 6.1 Add `ROUTES.settings`, the `settings` view, and the cogwheel button in the `AppSidebar.tsx` footer with an accessible label and `aria-current`; verify with a router test for `/settings` and by checking the button in the running UI
- [ ] 6.2 Models section: OpenCode and Pi cards with Session and Manual choices, the model picker or typed fallback, the read-only fallback and effective model, and the project override notice; verify in the running UI that saving each option updates the active config file as the spec describes
- [ ] 6.3 Capture diagnostics section: time range, rates by model, reasons, recent attempts table, trace switch with warning, retention fields, trace list with view and delete; verify in the running UI against seeded attempt rows and trace files
- [ ] 6.4 Health section: run checks, optional model tests, pass, warn, and fail rows; verify in the running UI with a deliberately broken model setting
- [ ] 6.5 Import and backfill section: host choice, all CLI options, model choice, dry-run preview, progress, cancel, and report; verify in the running UI with a Pi dry run and a small real import
- [ ] 6.5a Log section: monospace scrollable box, capture attempts filter, refresh, and the log path with a copy button; verify in the running UI with the real log
- [ ] 6.6 Add i18n strings for every new label in every supported language; verify with `cd web && bun run check`

## 7. Docs

- [ ] 7.1 Update `docs/web-ui.md` (Settings page), `docs/configuration.md` (keys editable from the page, live reload), and `docs/cli.md` (link to the page); verify with `bun run check`
- [ ] 7.2 Add an ADR for editing the global config from the web UI and add it to the ADR index; verify with `bun run check`

## 8. Verification

- [ ] 8.1 Run `bun run ci:local` and confirm it passes
- [ ] 8.2 Manually, with OpenCode and Pi both running: switch each host between Session and Manual from the page and confirm the next capture uses the chosen model without a restart; turn tracing on and off; run health checks; run and cancel a Pi backfill
