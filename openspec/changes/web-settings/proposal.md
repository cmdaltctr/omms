# Proposal

## Why

Everything beyond browsing memories needs a config file edit or a terminal command. That includes choosing the capture model for each host, turning the new capture diagnostics on and off (see the `capture-diagnostics` change), checking whether OMMS is healthy, and running history imports. The web UI is already open while people work, so it should cover these tasks too.

## What Changes

- A cogwheel button is added to the sidebar footer, next to the language, theme, and GitHub buttons. It opens a new Settings page at `/settings`.
- **Models section:** one card for OpenCode and one for Pi. Each card chooses between **Session model** (writes `inherit`) and **Manual model** (a provider and model picked from that host's signed-in models, or typed in when the list is not available). This writes `opencodeProvider`/`opencodeModel` or `piProvider`/`piModel`. The card also shows, read-only, the external API fallback and the model order from the live-model rule. The order itself does not change.
- **Capture diagnostics section:**
  - Tier 1 shows save, skip, and failure rates for each model, failures by reason code, and a table of recent attempts.
  - Tier 2 has the `captureTrace` switch and `captureTraceRetentionDays`, a list of trace files with view and delete actions, and a warning that traces can contain conversation content.
- **Health section:** one "Run checks" action. It checks the config file, store access, the embedding model, the web server binding and auth, the model each host would use, and capture success over the last 24 hours. Each result is pass, warn, or fail with a short reason. An optional test call checks each configured model.
- **Import and backfill section:** lists Pi and OpenCode sessions by project and date. People can select sessions, select all matching sessions, preview the selection, and then import it. The preview and the import use the same pinned set of sessions and the same turn cutoff. Advanced options include a source for a Pi sessions folder or one `.jsonl` file, or an OpenCode database file: a path field everywhere, plus a folder browser when the server is on loopback. Prompt date limits, directory maps, and retry controls stay available but no longer crowd the main view. Selection replaces the single-session and maximum-sessions fields on the page. The page checks model readiness before a real import: it needs an OpenCode-connected model or a complete saved external API. Progress, cancellation, the final report, and the one-job limit remain.
- Settings are saved to the global config file OMMS is actually reading. That is `~/.config/omms/omms.jsonc`, or on installs that still use the legacy `~/.config/opencode/opencode-mem.jsonc`, a new `omms.jsonc` copied from it with the change applied. The legacy file is never written. Comments and all other keys are kept. Running OpenCode and Pi processes pick up the new values for their next capture without a restart.
- **Log section:** a box that shows the latest lines of the OMMS log (`~/.omms/omms.log`), with a "capture attempts only" filter, a refresh button, and the log's path with a copy button.
- Every endpoint that changes something, or reads history sources and session lists, accepts requests only from an allowed origin and only as JSON `POST`s. When the server is not on loopback, it also requires the existing API token or Basic Auth. Secret values are never sent to the browser.
- Capture attempt records are also stored in the memory store, so the page can show rates without reading log files.

## Capabilities

### New Capabilities

- `web-settings`: the Settings page, its sections (including the log viewer), the settings and import API, safe config writes, live config reload, and the access rules for changes made from the page.

### Modified Capabilities

- `capture-diagnostics` (introduced by the `capture-diagnostics` change): adds a requirement that attempt records are stored in the memory store with a retention limit, so the web page can query them.

## Impact

- Depends on the `capture-diagnostics` change. Implement that change first.
- Web (`web/`): a cogwheel button in `AppSidebar.tsx`, a `/settings` route in `router.ts`/`routes.ts`, a new `SettingsView` with five sections, and i18n strings for every supported language.
- Server (`src/services/web-server.ts`, `api-handlers.ts`): endpoints for settings read and write, the model list, diagnostics queries, trace files, health checks, and import jobs.
- Config (`src/config.ts`, `src/services/jsonc.ts`): a comment-preserving writer for the global config and a reload when the file changes.
- Importer (`src/importer/`): a `web` import surface, a `sessionIds` filter used only by the page, one-file Pi sources, bounded Pi header reads, a project resolver shared by the session list and the importer, and an asynchronous, cancellable OpenCode snapshot that can be reused. Existing CLI flags, their meaning, and ledger identities stay intact. Two exceptions, both fixes: `--root` pointing at one `.jsonl` file now imports that file instead of finding nothing, and an OpenCode directory map now takes precedence over a recorded directory that still exists, as it already does for Pi. The page's session selection is validated outside the shared option parser; only the remaining options go through the parser.
- Storage: a new `capture_attempts` table.
- Pi: the Pi model list is read through the Pi SDK peer dependency when it is installed.
- The web UI is served only by the OpenCode plugin, as today. Settings made there apply to both hosts because they share the config file.
- Docs: `docs/web-ui.md`, `docs/configuration.md`, `docs/cli.md` (link to the page), and an ADR for editing config from the web UI.
