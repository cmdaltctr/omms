# Design

## Context

For the motivation, see proposal.md, section Why. This change builds on the `capture-diagnostics` change, which must be implemented first.

Relevant facts about the current code:

- **The web UI.** It is a Vite and React app in `web/`, with two views, `project` and `profile`, routed by `web/src/lib/router.ts`. The sidebar footer (`AppSidebar.tsx`) is a bordered button group: language, theme, and GitHub.
- **The web server.** `src/services/web-server.ts` runs only inside the OpenCode plugin process. It already enforces an origin check (`cors.ts`, loopback origins, or any origin when Basic Auth is on), the optional API token for non-loopback binds, and Basic Auth.
- **Config.** `src/config.ts` exports `let CONFIG`, which `initConfig(directory)` rebuilds from the global and project files. Because it is a live ES module binding, calling `initConfig` again updates every importer. `src/services/jsonc.ts` can strip comments but cannot edit a file in place.
- **Host models.** OpenCode keeps the set of connected providers in `opencode-provider.ts` (`_connectedProviders`). Pi models are available inside Pi through `ctx.modelRegistry`. The OpenCode process has no Pi registry.
- **Imports.** `runHistoryImport` (`src/importer/run-import.ts`) already reports progress through `onProgress(processed, total, preview)` and records units in the ledger. It has no cancellation. `ImportSurface` is `"session" | "cli"`.

## Goals / Non-Goals

**Goals:**

- One settings page with five sections, backed by a small JSON API on the existing server.
- Config edits that a person who hand-edits their config file will not notice, apart from the changed values.
- Changes that reach running Pi and OpenCode processes without a restart.

**Non-Goals:**

- Editing secrets (API keys, passwords, tokens) or the external API settings. They stay in the config file.
- Editing project config files from the page.
- Starting the web UI from Pi.
- Calling Pi models from the OpenCode process. Web imports use OpenCode models or the external API.
- Changing the live-model order. It stays in `live-model-choice.ts`.

## Decisions

### Page and navigation

The page gets a new route, `ROUTES.settings = "/settings"`, and the `AppView` union gains `"settings"`. The cogwheel (`Settings` icon from `lucide-react`, which the app already uses) becomes a fourth button in the footer group, between the theme and GitHub buttons, styled like the theme button and marked with `aria-current` when active. `SettingsView` has five sections in this order: Models, Capture diagnostics, Health, Import and backfill, Log. Each section loads its own data, so one slow check does not block the page.

- Alternative: a modal dialog. Rejected. Imports run for minutes and need a page that survives a reload and can be linked to.

### API surface

All endpoints live under `/api/settings/`:

| Method       | Path                                     | Purpose                                                                          |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------- |
| GET          | `/api/settings`                          | Effective values, where each came from (default, global, project), secret status |
| PATCH        | `/api/settings`                          | Validate and write changed global keys                                           |
| GET          | `/api/settings/models?host=opencode\|pi` | Signed-in models, or `{ available: false, reason }`                              |
| GET          | `/api/settings/diagnostics`              | Aggregates and recent attempts for a time range                                  |
| GET / DELETE | `/api/settings/traces[/:file]`           | List, read, or delete trace files (names must match the pattern)                 |
| POST         | `/api/settings/health`                   | Run checks; `{ testModels: true }` adds the model test calls                     |
| GET          | `/api/settings/log?lines=&filter=`       | Last lines of the OMMS log (at most 256 KB read, optional `filter=capture`)      |
| POST         | `/api/settings/imports`                  | Start an import job (`host`, options, model choice)                              |
| GET          | `/api/settings/imports/current`          | Progress and report of the running or last job                                   |
| POST         | `/api/settings/imports/current/cancel`   | Cancel the running job                                                           |

The page polls job progress every second while a job runs. That avoids adding server-sent events to a server that has none.

### Safe config writes

`jsonc-parser` (Microsoft, MIT, no dependencies) is added. Its `modify` and `applyEdits` functions change one key at a time and keep comments and formatting. The write sequence:

1. Take the server's write lock, so saves from this process run one at a time.
2. Read the file and record its modification time and a hash of its contents.
3. Apply the edits.
4. Parse the result and validate the full config with the startup validation.
5. Check the file again. If its modification time or hash changed since step 2 (a hand edit, or another process such as a second OpenCode window), stop without writing and return `409 Conflict`; the page reloads the settings and asks the user to save again.
6. Write to a temporary file in the same directory, then rename it over the original, so a crash never leaves a half-written file.
7. Release the lock.

A change that lands in the short gap between step 5 and the rename can still be lost; the check makes that window milliseconds wide instead of the whole time the page was open.

- Alternative: an OS-level file lock. Rejected. Editors that save a hand edit do not take it, so it would not protect the case that matters most.

When the file does not exist, it is created from the existing config template with the key set.

- Alternative: extend `jsonc.ts`. Rejected. Its job is stripping comments, and a custom JSONC editor is a large new surface for bugs.
- Alternative: rewrite the file as plain JSON. Rejected. It would lose the user's comments and the template's documentation.

A PATCH accepts only a fixed list of keys: the four host model keys, `captureTrace`, `captureTraceRetentionDays`, and `captureAttemptRetentionDays`. Any other key is rejected.

### Which file is written

`src/config.ts` reads the first file that exists in `CONFIG_FILES`. The legacy `opencode-mem.jsonc` (from opencode-mem, the plugin OMMS was forked from) is read only while no `omms.jsonc` exists, and is never written (decision D13). The writer asks the config module which file it loaded. When that is the legacy file, the first save copies it byte for byte to `~/.config/omms/omms.jsonc` and applies the edits to the copy. From then on OMMS reads the new file, which holds every existing setting, so nothing is lost. The response tells the page to show a one-time notice.

- Alternative: always write `omms.jsonc` with only the changed keys. Rejected. Creating it would make OMMS stop reading the legacy file, and every other setting would silently fall back to defaults.

### Log viewer

The log endpoint reads the tail of `getLogFilePath()` from `src/services/log-path.ts` (at most the last 256 KB, trimmed to whole lines) and returns up to `lines` lines, default 200, maximum 2,000. With `filter=capture` it keeps only `Capture attempt` lines. The path always comes from the server's own config, never from the request. The page renders the lines as plain text in a monospace, scrollable box. A page served over HTTP cannot open a `file://` link, so the page shows the path with a copy button instead of a link. Since `capture-diagnostics` removed reply text from the log, the log holds only metadata, identifiers, and error messages.

### Live reload

The shared helper `refreshConfigIfChanged(directory)` checks the global and project config files' modification times and sizes. When either has changed since the last load, it calls `initConfig(directory)`. The capture pipeline and the profile learner call it before each unit. The web server calls it after each PATCH. Because this is only a `stat` per capture, a file watcher is not needed. File watchers are also unreliable across editors and network drives.

### Model lists

- **OpenCode:** the server lists models from the connected providers that the plugin already tracks, and fetches each provider's models through the v2 client.
- **Pi:** the server tries a dynamic `import("@earendil-works/pi-coding-agent")` and builds a model registry from Pi's auth and model files, read-only. If the import or the read fails, the API returns `available: false` and the card falls back to typed input. It never writes Pi files.

### Capture attempt store

A `capture_attempts` table is added to the store with the diagnostics fields from `capture-diagnostics`, indexed on time, host, and model. `emitCaptureAttempt` inserts into it in the same `try/catch` as the log line. The existing cleanup service deletes rows older than `captureAttemptRetentionDays`. The rates and the table on the page query this table.

### Imports from the page

- `ImportSurface` gains `"web"`. The page sends structured options, which the server turns into the same argument list the CLI builds, so the shared parser validates both paths.
- The model choice is either an OpenCode `provider/model`, run through the same OpenCode structured-output path as live capture, or the saved external API.
- `runHistoryImport` gains an optional `AbortSignal`, checked between work units, so a cancel lands on a unit boundary and the ledger stays consistent.
- One in-memory job slot is used per server process. The ledger's existing locking protects against a CLI import running at the same time.

### Access control

A new guard wraps every mutating settings endpoint:

1. The existing origin check.
2. The existing token or Basic Auth when the server is not on loopback.
3. A body that is JSON with a `Content-Type: application/json` header. Cross-site simple form posts cannot set that header, which blocks them.

Turning `captureTrace` on is refused when the server is not on loopback and Basic Auth is off.

## Risks / Trade-offs

- [The page writes the user's config file] → Only fixed keys can be written, the change is checked before writing, the rename is atomic, and comments are kept. The ADR records this choice.
- [Pi SDK internals may change] → The Pi model list is best effort, with a typed fallback. It is read-only and never blocks saving.
- [A long import runs inside the OpenCode plugin process] → Imports already run in that process from the slash command. Cancel and the single job slot keep it bounded.
- [Settings apply only while OpenCode serves the UI] → The docs say that Pi users can open the page while OpenCode runs, or edit the config file.
- [The live-reload stat on every capture] → This is one or two `stat` calls per unit, which is small next to a model call.

## Migration Plan

This is additive. The new table is created by the normal store migration on first start. With no settings saved from the page, behaviour is the same as before. Rollback means reverting the change; the extra table is harmless to older versions.

## Open Questions

- Which Pi SDK entry point gives a read-only model registry outside a Pi session? The fallback keeps the spec and tasks the same whatever the answer is.
