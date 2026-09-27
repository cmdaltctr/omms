# Tasks

## 1. Prerequisites

- [x] 1.1 Confirm the `capture-diagnostics` change is implemented and merged, or rebase this work on it; verify with `openspec status --change capture-diagnostics` showing all tasks done

## 2. Config writes and reload

- [x] 2.1 Add `jsonc-parser` and a `writeGlobalConfigKeys(edits)` service that allows only the listed keys, validates the result, and writes through a temporary file and rename; verify with tests for keeping comments, key order, and other keys, rejecting unknown keys, rejecting invalid values with the file unchanged, creating a missing file from the template, two concurrent saves both landing in order, and a save rejected with `409` when the file changed after it was read
- [x] 2.1a Make the writer target the config file OMMS loaded, and on a legacy-only install copy `opencode-mem.jsonc` to `~/.config/omms/omms.jsonc` before the first edit; verify with tests that the legacy file is unchanged, the new file keeps every key and comment, and the response asks for the notice
- [x] 2.2 Add `refreshConfigIfChanged(directory)` and call it before each capture unit and profile-learning run on both hosts; verify with a test that changes `piModel` on disk and sees the next capture resolve the new model without a restart
- [x] 2.3 Add `captureAttemptRetentionDays` (default `30`, minimum `1`) to `src/config.ts` and the template; verify with a config defaults test

## 3. Attempt store

- [x] 3.1 Add the `capture_attempts` table and its migration, and insert a row from `emitCaptureAttempt` without prompt or reply text; verify with a store test that a saved, skipped, and failed attempt each produce one row, that no text column exists, and that an insert failure leaves the outcome unchanged
- [x] 3.2 Delete rows older than `captureAttemptRetentionDays` in the cleanup service; verify with a cleanup test using fixed dates
- [x] 3.3 Add a query service for rates by host and model, counts by reason, and recent attempts over a time range; verify with tests on seeded rows

## 4. Settings API

- [x] 4.1 Add the mutation guard (origin check, token or Basic Auth when not on loopback, JSON content type) and the `captureTrace`-over-network refusal; verify with web-server tests for a foreign origin, a form post, a non-loopback request without a token, and tracing turned on over `0.0.0.0` without Basic Auth
- [x] 4.2 `GET` and `PATCH /api/settings` with value sources and secret status only; verify with tests that no secret value appears in any response and that the project override is reported
- [x] 4.3 `GET /api/settings/models` for OpenCode (connected providers) and Pi (dynamic SDK load with fallback); verify with tests for a listed model set and for `available: false` when the Pi SDK import fails
- [x] 4.4 `GET /api/settings/diagnostics` and the trace list, read, and delete endpoints with a strict file-name pattern; verify with tests that path traversal names are rejected
- [x] 4.4a `GET /api/settings/log` reading at most the last 256 KB of the log with a line limit and `filter=capture`; verify with tests for the filter, the line limit, a missing log file, and that a `path` query parameter is ignored
- [x] 4.5 `POST /api/settings/health` with every check from the spec and optional model test calls with a fixed prompt; verify with tests for pass, warn at over 20% failures, and a failing model test whose error has the key removed

## 5. Imports from the page

- [x] 5.1 Add the `"web"` import surface and turn structured page options into the shared parser's input. Reopened: remove `session` and `maxSessions` from the web options (`web-import-jobs.ts`, `WebImportOptions`, `webImportTokens`), require absolute source paths, and validate `selection` outside the parser. Verify with tests that:
  - the remaining page options and the equivalent CLI flags produce the same parsed options
  - a web request with `session`, `maxSessions`, or a relative source is rejected
- [x] 5.2 Add an optional `AbortSignal` to `runHistoryImport`, checked between units; verify with an importer test that cancels mid-run and a rerun that imports only the remaining units
- [x] 5.3 Add the job endpoints (start, current, cancel) with one job slot and model choice (OpenCode model or external API). Reopened: a preview takes the slot too, and a job carries a `selection`. Verify with tests for:
  - a refused second job, including a preview while an import runs
  - a dry run that makes no model calls
  - ledger reuse after a CLI import
- [x] 5.4 Add the shared project resolver `src/importer/import-project.ts`, returning `{ directory, via }` with map, recorded, worktree (OpenCode only), unresolved precedence. Use it in the Pi importer, the OpenCode importer, and the session list. Record the OpenCode map-precedence change in a TDR and add it to the TDR index. Verify with tests that:
  - an OpenCode map whose source still exists now wins
  - Pi behaviour is unchanged
  - the worktree fallback reports `via: "worktree"`
  - the listed set and the imported set are equal for maps, worktree fallback, and real-path (`/var` → `/private/var`) cases
- [x] 5.5 Pi sources: a bounded (64 KB) header reader shared by the CLI and the page, and a `pi-file` source discovered as one session. When the header has an ID, the loaded ID must equal it, or the file is a load error. Verify with tests that:
  - `--root <file>` and the page both import exactly that file, where `--root <file>` used to find nothing
  - a large file's header is read without reading the whole file
  - a header without an ID is listed by its relative path
  - an ID mismatch is a load error
  - a symlinked entry in a folder is skipped
  - existing CLI `--session` and `--max-sessions` results are unchanged
- [x] 5.6 Source endpoints: `POST sources/validate` (absolute path, no `..`, `realpath`, kind and format check, signed source token with real path, device, and inode) and `POST sources/browse` (loopback only, one level, symlinked entries hidden). Verify with tests that:
  - a symlinked root or ancestor is accepted
  - relative and `..` paths are refused
  - a wrong format is refused without contents in the error
  - browse returns `403` on a non-loopback bind
  - a source swapped after validation is refused at job start
  - a mounted-volume path works (fixture folder)
- [x] 5.7 OpenCode snapshots:
  - an asynchronous, cancellable copy (clone first)
  - a `statfs` free-space check (database + WAL + max(256 MB, 10%))
  - one attempt for sources on another device or larger than 1 GB
  - reuse per source token, with a reference count and a 30-minute idle limit
  - an `owner.json` file, and a startup sweep of snapshots whose owner process is gone, in the plugin and the CLI
  - refusal when a `-journal` file exists, and a WAL recheck after an in-place read
  - building turns one session at a time, after a counting pass

  Verify with tests that:
  - insufficient space fails before copying, with sizes in the error
  - a cancelled copy leaves no folder
  - listing, preview, and import copy once
  - the sweep removes a dead owner's folder and keeps a live one's
  - the source database, `-wal`, and `-shm` hashes are unchanged
  - the event loop stays responsive during a copy (a timer fires during a large fixture copy)

- [x] 5.8 `POST sessions`: paged metadata, `total`, `revision` (SHA-256 of host, source identity, scope, project, maps, and sorted matching keys; no file stamps), `listedAt`, resolution per row, and an unresolved count for current-project scope. Verify with tests that:
  - responses carry no prompt, reply, or tool text
  - adding turns keeps the revision
  - adding a session, or changing maps, changes it
- [x] 5.9 Selections: `selectionKeys` in `ImportFilters` and `OpencodeImportOptions`, applied during discovery before the project filter, and exclusive with `session` and `maxSessions`; `mode: "ids"` (at most 1,000 keys) and `mode: "all"` with excluded keys; stale refusal (`409`); a turn cap at `listedAt`; no server-side selection state. Verify on both hosts that:
  - preview and import of the same selection report the same sessions and turns
  - a new session makes `all` stale but not `ids`
  - a removed or re-projected key makes `ids` stale
  - turns added after listing are excluded from both, counted as held back in the report, and imported by a second run from a fresh listing
  - cancelling while sessions load stops before any unit runs
  - ledger keys are unchanged
- [x] 5.10 Readiness: `GET imports/readiness` (external state from `selectImportModel` rules with secrets resolved in-process, connected OpenCode models, Pi reader availability), the same checks in `POST imports` returning `400`, and a default model choice of the first ready source. Verify with tests for:
  - an unset `env://` key
  - a missing URL
  - no ready source (dry run still accepted, import rejected)
  - a missing Pi SDK disabling Pi jobs
  - no secret values in any response
- [x] 5.11 Make `sources/validate`, `sources/browse`, `sessions`, and the job endpoints JSON `POST`s under the mutation guard. Verify with a web-server test that a cross-site request with Basic Auth on, and one without a JSON body, is rejected before any source is read or copied.

## 6. Web UI

- [x] 6.1 Add `ROUTES.settings`, the `settings` view, and the cogwheel button in the `AppSidebar.tsx` footer with an accessible label and `aria-current`; verify with a router test for `/settings` and by checking the button in the running UI
- [x] 6.2 Models section: OpenCode and Pi cards with Session and Manual choices, the model picker or typed fallback, the read-only fallback and effective model, and the project override notice; verify in the running UI that saving each option updates the active config file as the spec describes
- [x] 6.3 Capture diagnostics section: time range, rates by model, reasons, recent attempts table, trace switch with warning, retention fields, trace list with view and delete; verify in the running UI against seeded attempt rows and trace files
- [x] 6.4 Health section: run checks, optional model tests, pass, warn, and fail rows; verify in the running UI with a deliberately broken model setting
- [x] 6.5 Replace the import form with a host-specific paged session list. Build:
  - the resolution column and the unresolved-sessions notice with its switch to all-projects scope
  - individual and select-all-matching selection, and counts
  - a stale-selection refresh prompt, which also appears when the maps change
  - a dry-run preview showing session, turn, and untimed-turn counts
  - readiness per model source labelled "configured, not tested", with a link to the Health model test, and the default set to the first ready source
  - Advanced: the path field on every bind, and the browser on loopback only

  Prompt dates are sent as epoch ms for the local day's start and end. Remove the session ID and maximum sessions fields. Verify in the running UI:
  - both host lists and a mounted-volume path
  - prompt-date help and a time-zone check (UTC+8 browser, turn at 23:30 local)
  - keyboard selection, preview, progress, cancel, and a small fixture import

- [x] 6.5a Log section: monospace scrollable box, capture attempts filter, refresh, and the log path with a copy button; verify in the running UI with the real log
- [x] 6.6 Add i18n strings for every new label in every supported language; verify with `cd web && bun run check`
- [x] 6.7 Translate the new session list and Advanced labels in every supported language; verify with the Settings i18n test and `cd web && bun run check`

## 7. Docs

- [x] 7.1 Update `docs/web-ui.md` (Settings page), `docs/configuration.md` (keys editable from the page, live reload), and `docs/cli.md` (link to the page); verify with `bun run check`
- [x] 7.2 Add an ADR for editing the global config from the web UI and add it to the ADR index; verify with `bun run check`
- [x] 7.3 Update `docs/web-ui.md` for the session-first import and the Advanced source. Explain:
  - Pi takes a `.jsonl` file or a folder; OpenCode takes a database
  - browsing is loopback-only
  - prompt dates use the browser's time zone
  - turns after the listing time wait for the next run
  - large OpenCode databases need free temporary space, and one copy is reused
  - a real web import needs an OpenCode model or a complete external API, and the Pi SDK is needed for Pi imports

  Update `docs/cli.md` for `--root <file>` and the OpenCode map precedence.

## 8. Verification

- [x] 8.1 Run `bun run ci:local` and confirm it passes
- [x] 8.2 Manually, with OpenCode and Pi both running: switch each host between Session and Manual from the page and confirm the next capture uses the chosen model without a restart; turn tracing on and off; run health checks; run and cancel a Pi backfill Result (3.2.0-next.12, real OpenCode and Pi): model switching reached live capture on both hosts without a restart, and health checks passed. Trace delete, cross-section saves, the OpenCode v2 model list, and deep Pi folders failed; PR #23 fixed them, verified by regression tests and an isolated browser run.
- [x] 8.3 Re-run `bun run ci:local` after the session-selection implementation. Use temporary fixture histories for:
  - a one-file Pi import
  - a multi-session Pi import
  - an OpenCode database with a WAL, including a new session and new turns added between listing and import

  Confirm by hash that the source files are unchanged, and that no `omms-opencode-*` folder remains. Leave the user's NVMe backups untouched. Verify the UI in a browser with both hosts, the no-model warning, and a stale-selection refresh.
