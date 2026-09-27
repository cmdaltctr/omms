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
| POST         | `/api/settings/imports/sources/browse`   | Loopback only: one folder's subfolders and eligible files, no recursion          |
| POST         | `/api/settings/imports/sources/validate` | Check an absolute source path; return its kind and a source token                |
| POST         | `/api/settings/imports/sessions`         | One page of session metadata, the selection revision, and the listing time       |
| GET          | `/api/settings/imports/readiness`        | Model and reader readiness for a real import; no secret values, no side effects  |
| POST         | `/api/settings/imports`                  | Start a preview or import job (`host`, selection, options, model choice)         |
| GET          | `/api/settings/imports/current`          | Progress and report of the running or last job                                   |
| POST         | `/api/settings/imports/current/cancel`   | Cancel the running job                                                           |

The page polls job progress every second while a job runs. That avoids adding server-sent events to a server that has none.

The source and session endpoints are `POST`s even though they change no settings. Listing an OpenCode database can copy gigabytes. A `GET` would skip the JSON content-type check, and with Basic Auth on it would also skip the token check for `/api/settings*`. A page on another site could then start that work, even though it cannot read the reply. As `POST`s with a JSON body, they go through the same mutation guard as every other change.

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

- `ImportSurface` gains `"web"`. CLI and slash-command flags keep their current meaning. The page sends a `selection` object and an `options` object. The server validates `selection` itself and turns it into a new `selectionKeys` importer filter; the shared parser never sees it. `options` goes through `webImportTokens` and the shared parser as before. `session` and `maxSessions` are removed from the web options: selection replaces both, so the page has only one way to choose sessions.
- `runHistoryImport` gains an optional `AbortSignal`. It is checked between work units, while the Pi importer loads sessions, while the OpenCode reader yields sessions, and during a snapshot copy. A cancel therefore stops loading a large selection early, and it lands on a unit boundary once units run, so the ledger stays consistent.
- One in-memory job slot is used per server process. A preview is a job like an import, so it also takes the slot. The ledger's existing locking protects against a CLI import running at the same time.

#### Session selection and the revision

`ImportFilters` (Pi) and `OpencodeImportOptions` gain `selectionKeys?: string[]`. Only the web surface sets it, and it cannot be combined with `session` or `maxSessions`. When it is set, the importer applies it during discovery, before the project filter. The CLI's order stays unchanged: `maxSessions` first, then `session`, then the project filter (`discovery.ts`, `opencode-reader.ts`). CLI tests pin that order.

Each listed session has a selection key:

- **OpenCode:** the session ID.
- **Pi:** the file path relative to the source root. This path is unique even when a header has no ID or two files share one.

The Pi importer checks that the ID `SessionManager` loads matches the header ID. When the header has an ID and the two differ, the file is reported as a load error. Ledger keys do not change: they are still `host:sessionId:userEntryId:terminalEntryId`, built from the loaded session ID. The key does not contain the file path, so a session imported once from its usual folder counts as already done when it is imported again from a backup copy.

The session list reply includes `total`, one page of rows, `revision`, and `listedAt` (server time in epoch ms). `revision` is a SHA-256 hash of:

- the host and the source identity: its real path, device, and inode
- the options that decide which sessions match: scope, project, and directory maps
- the sorted selection keys of every matching, resolvable session

The revision never uses file sizes or modification times. The server runs inside OpenCode, which writes its database on every message, and an active Pi session file grows while it is used. A revision built from file stamps would be stale on every import. Adding turns to a session leaves the revision the same. Adding, removing, or re-projecting a session changes it.

The server keeps no selection state between requests. The page sends one of two selections:

- `{ mode: "ids", keys, revision, listedAt }`, with at most 1,000 keys. At preview and import, the server re-resolves each key. It refuses the job with `409 stale` when a key no longer exists or now resolves to a different project. New sessions do not matter in this mode.
- `{ mode: "all", excludedKeys, revision, listedAt }`. At preview and import, the server re-resolves the filter and recomputes the revision. It refuses the job with `409 stale` when the revision differs, so a newly created session can never be added silently.

Both modes cap each unit's user-turn time at `listedAt`, in addition to any Prompt date to limit. Preview and import therefore read the same turns, even when a selected session keeps growing. A later run started from a fresh listing picks up the newer turns under the same ledger keys. The report states how many turns were held back as newer than `listedAt`, for example "newer turns held back: 12; list the sessions again and import to include them". Held-back turns are never written to the ledger, so no turn is marked handled without being imported. For OpenCode with a WAL, preview and import also read the same snapshot (see below). Dry-run counts, rerun skips, and profile batching keep their current behaviour.

#### Project resolution

A new shared module, `src/importer/import-project.ts`, resolves a session's recorded directory. The session list and both importers call it, so the list, the selection revision, and the imported set always agree. It returns `{ directory, via }`, where `via` is one of:

1. `mapped`: a directory map matches the recorded path exactly, and its target is a directory.
2. `recorded`: the recorded directory exists.
3. `worktree` (OpenCode only): the recorded directory is missing, and the project worktree exists and is not `/`. The worktree is the same OpenCode project, so this does not move memories to another project. The list shows the fallback so it is visible.
4. `unresolved`.

Maps come first on both hosts. Pi already works that way. For OpenCode this is a behaviour change: a map whose source path still exists used to be silently ignored. It is recorded in `docs/tdr/` and covered by a regression test. Current-project matching compares real paths, as `projectFilterTag` does today.

In current-project scope, unresolved sessions cannot be matched to the project, so they cannot appear in the list. The list therefore shows "N sessions have recorded directories that no longer exist", with an action that switches to all-projects scope and opens the directory maps. In all-projects scope, unresolved rows show their recorded path and cannot be selected until a map resolves them.

#### Sources and path rules

A source is a server-side path, never an upload. There are three kinds: `pi-folder`, `pi-file` (one `.jsonl`), and `opencode-db` (any SQLite file that passes the V1 schema check, whatever its name).

- **Path entry, on every bind:** a person enters an absolute path. The validate endpoint rejects relative paths and paths that contain `..` segments. It resolves the path with `realpath`, so symlinks at or above the chosen path are accepted. Examples are `/tmp` on macOS and a `~/.pi` linked to another volume. The endpoint checks the kind and format, then returns `{ kind, displayPath, sourceToken }`. The token is signed by the server process and holds the real path, device, and inode. Later requests send the token instead of a path. At job start the server stats the path again and refuses the job when the device or inode has changed.
- **Browse, on loopback binds only:** the chooser lists one folder at a time and does not recurse. It starts at the host's default location and shows subfolders and eligible `.jsonl` or `.db` files. Entries that are symlinks are hidden. On a non-loopback bind the browse endpoint returns `403`, and the page shows only the path field. A remote user therefore cannot list the machine's folders.
- **Inside a Pi folder**, discovery keeps skipping symlinked entries, as `readdirSync` with `withFileTypes` already does.
- **Pi header reads are bounded:** the first line is read from at most the first 64 KB, instead of the whole file. The CLI and the page share this reader. A file root is discovered as one session. The CLI's `--root` therefore also accepts one file, which today silently finds no sessions.
- **Errors** name the file and give a reason code, and never include file contents. On a non-loopback bind, any path in an error or report is shown relative to the source, apart from the recorded project directories the list shows on purpose.

#### OpenCode snapshots

The reader keeps its current rules. A database without a WAL is opened in place with `immutable=1`. A database with a WAL is read from a private copy, so OpenCode's database, `-wal`, and `-shm` files are never opened for writing. The following changes are made for large sources and for running inside the OpenCode process:

- **No-WAL race:** when a `-journal` file exists, the source is refused as busy. After an in-place read, the reader checks again that no `-wal` has appeared and that the database stamp has not changed. When either check fails, the read is retried through the snapshot path.
- **Free space:** before copying, the server checks `statfsSync(tmpdir())`. The available bytes must be at least the database size plus the WAL size plus the larger of 256 MB and 10%. When they are not, the job fails before any copy, with the needed and available sizes in the error.
- **Asynchronous copy:** the copy runs as an asynchronous, cancellable stream copy. A copy-on-write clone is tried first. The event loop that serves the web UI and live capture never blocks for the length of a copy. Session reads yield to the event loop between sessions.
- **Retries:** when the source is on a different device from the temporary folder, or is larger than 1 GB, the copy makes one attempt instead of five. If the source changed during that copy, the error says to quit OpenCode or choose a checkpointed backup.
- **Reuse:** one snapshot is kept per source token, with a reference count and a 30-minute idle limit. The listing, the preview, and the import reuse it, so an 8 GB database is copied once. A preview or import holds a reference until it ends. A snapshot that has expired makes the job stale, and the page asks for a refresh. Because the snapshot does not change, `mode: "all"` over a snapshot cannot pick up a new session.
- **Cleanup:** each snapshot folder, `omms-opencode-*`, holds an `owner.json` file with the process ID and creation time. The folder is removed when a real import ends (success, failure, or cancellation), on a failed or cancelled copy, on expiry, and on server shutdown. A preview keeps it for the import that follows. When the web server starts, and before every new copy (which covers the CLI and slash commands), OMMS deletes any snapshot folder whose owner process is no longer running. A running CLI import's folder is never deleted.
- **Memory:** the OpenCode importer stops holding every session's turns in memory. A counting pass builds each session's turns, applies the same date, cutoff, and key filters, keeps only the counts, and releases them. The import pass then builds turns again, one session at a time. The preview reports the selected session and turn counts.

#### Prompt date limits

The page shows **Prompt date from** and **Prompt date to**. Both are inclusive and apply to individual user turns, not to session creation dates. They do not filter the session list, because a session created before the start date can still contain turns inside the range. The page converts each date to epoch ms at the start or end of that day in the browser's time zone. It sends numbers, so the server's UTC reading of bare dates, which the CLI keeps, never shifts the range. An empty limit leaves that side open. Turns that have no timestamp are included, as they are today, and the preview reports how many there are.

#### Model readiness

`GET /api/settings/imports/readiness` returns, without secret values:

- `external`: one of `ready`, `missing-model`, `missing-url`, `missing-key`, or `unsupported-provider`. It is checked with the same rules as `selectImportModel`. `env://` and `file://` keys are resolved inside the server process, which is OpenCode's environment, not the user's shell.
- `opencode`: the connected providers and their models.
- `piReader`: `available`, or `unavailable` with a reason, depending on whether `@earendil-works/pi-coding-agent` can be loaded in this process. Pi sessions are loaded through it even for a dry run.

The page picks the first ready model as the default. When none is ready, Import is disabled with the reason, and Preview stays available. When the Pi reader is unavailable, Pi preview and import are also disabled with the reason. Every state is labelled "configured, not tested", with a link to the Health section's model test. `POST /api/settings/imports` runs the same checks before it accepts a job and returns `400` with the reason. A misconfigured model therefore never turns into a job that fails later. Pi credentials alone never count as a ready web-import model, because the OpenCode process cannot call Pi models.

### Access control

A new guard wraps every mutating settings endpoint, and the import source, session list, and job endpoints:

1. The existing origin check.
2. The existing token or Basic Auth when the server is not on loopback.
3. A body that is JSON with a `Content-Type: application/json` header. Cross-site simple form posts cannot set that header, which blocks them.

Turning `captureTrace` on is refused when the server is not on loopback and Basic Auth is off.

## Risks / Trade-offs

- [The page writes the user's config file] → Only fixed keys can be written, the change is checked before writing, the rename is atomic, and comments are kept. The ADR records this choice.
- [Pi SDK internals may change] → The Pi model list is best effort, with a typed fallback. It is read-only and never blocks saving.
- [A long import runs inside the OpenCode plugin process] → Imports already run in that process from the slash command. Cancel and the single job slot keep it bounded.
- [Source browsing can expose local paths] → Browsing works only on loopback. On other binds the page accepts typed paths only. Every source endpoint is a guarded JSON `POST`, returns metadata only, and never sends transcript content.
- [An OpenCode database on another volume can require a large temporary copy] → Check free space first, copy asynchronously, allow cancellation, make one attempt for large or cross-device sources, reuse one snapshot per source, remove orphaned snapshots at startup, and leave the database, WAL, and SHM files untouched.
- [Selecting all sessions in a large database can load many turns] → A first pass counts turns, and turns are built for one session at a time. The preview shows the counts before anything is imported.
- [A path swapped for a symlink between validation and import] → The source token pins the real path, device, and inode, and job start checks them again.
- [OpenCode directory maps now take precedence over existing recorded directories] → This matches Pi, and a map is an explicit user choice. It is recorded in a TDR and covered by a regression test.
- [Settings apply only while OpenCode serves the UI] → The docs say that Pi users can open the page while OpenCode runs, or edit the config file.
- [The live-reload stat on every capture] → This is one or two `stat` calls per unit, which is small next to a model call.

## Migration Plan

This is additive. The new table is created by the normal store migration on first start. With no settings saved from the page, behaviour is the same as before. Rollback means reverting the change; the extra table is harmless to older versions.

## Open Questions

- Which Pi SDK entry point gives a read-only model registry outside a Pi session? The fallback keeps the spec and tasks the same whatever the answer is.
