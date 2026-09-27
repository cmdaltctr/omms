# Design

## Context

For the motivation, see proposal.md, section Why. For the required behaviour, see the four spec deltas.

Relevant facts about the current code:

- **Imports.** `runHistoryImport` (`src/importer/run-import.ts`) runs one host's import over the shared importer, which processes one work unit at a time, records each unit in `import-ledger.db`, and builds profile batches from the recorded prompts. It accepts an `AbortSignal`, an `onProgress` callback, and `until`, which limits user turns to a time. It is called today by the two session commands, the CLI, and the Settings page job runner (`web-import-jobs.ts`).
- **Host models.** Pi resolves models through `ctx.modelRegistry`: `resolveImportModel(ctx, "provider/id")` for a named model and `createPiLiveModels(ctx)` for the live-model rule. OpenCode builds import models with `createOpencodeImportModels({ providerID, modelID })` and knows its connected providers only after `ctx.client.provider.list()` returns. The external API is built by `selectImportModel({})`.
- **Live capture provenance.** Live capture stores `host`, `hostSessionId`, `sourceType: "live-capture"`, `promptId`, and `sourceEntryIds` in each memory's metadata. In Pi, the user entry ID is `promptId`; `sourceEntryIds` contains assistant entries. OpenCode uses user message IDs in `sourceEntryIds`. The importer does not check either field against live memories.
- **Config.** `refreshConfigIfChanged(directory)` reloads `CONFIG` when the config file changed. The Settings page writes only keys listed in `global-config-writer.ts` and shows keys listed in `settings-snapshot.ts`.
- **Web server.** `startWebServer` runs under Node or Bun and already negotiates port ownership and takeover between processes. Only the OpenCode plugin calls it.
- **Cross-process locks.** `src/services/turso/cross-process-write-lock.ts` implements a PID-liveness advisory lock with stale reclaim.

## Goals / Non-Goals

**Goals:**

- One host-neutral backfill runner in `src/importer/`, driven by thin calls from both adapters.
- Reuse the importer, ledger, and profile pipeline unchanged in behaviour, apart from the live-capture skip.
- A login item that survives package updates and never touches items OMMS did not create.

**Non-Goals:**

- Guessing directory maps for sessions from deleted worktrees. They are counted as unresolved; the Settings page import with directory maps covers them.
- Backfilling the other host's history. Each host imports its own history, because only it can call its own models.
- Running the backfill in the standalone web app. It has no host model access.
- Importing history from sources other than each host's default location. Other sources stay manual.
- A Windows service or a system-wide (all users) login item.

## Decisions

### D1. One runner, started by each adapter

`src/importer/auto-backfill.ts` exports `scheduleAutoBackfill({ host, cwd, resolveModels, notify, signal })`. OpenCode calls it from plugin init. Pi calls it once per active session from `session_start`, with a session-scoped abort signal and an active-task guard. The runner waits up to 30 seconds, unless the session shuts down, then:

1. returns if `CONFIG.autoBackfill` is false, or the kill switch `OMMS_DISABLE_AUTO_BACKFILL` is set;
2. takes the host lock (D4) or returns;
3. reads or creates the host's cutoff (D3);
4. runs a dry run over all projects with `until: cutoff`, which reports pending units without model calls;
5. returns with state `done` when nothing is pending; otherwise resolves the models (D5), shows the start notice, and runs the real import with the same arguments and an `AbortSignal`;
6. records the final report as the host's status and shows the finish notice.

Alternative: a job inside the Settings page's `SettingsImportJobs`. Rejected, because that object lives only in the process that owns the web server, and Pi never owns one.

### D2. Pacing and stopping

The importer already processes one unit at a time; the runner adds no parallelism. Between units, the runner's `onProgress` callback calls `refreshConfigIfChanged(cwd)` at most every 5 seconds and aborts the run when `autoBackfill` became false. It also writes the status (D6) at most every 5 seconds. The runner wraps the capture provider: after 5 consecutive thrown summaries it records the last error and aborts, so an unavailable model does not burn through thousands of failing calls. Failed units stay `failed` in the ledger and are retried on the next start.

Pi `session_shutdown` aborts the session-scoped signal and awaits the active runner before closing `memoryClient`. The delay is cancellable, so a session that ends during the first 30 seconds leaves no pending import. Once the task settles, its active-task guard is cleared. A later `session_start` in the same process may resume under the original cutoff.

Alternative: pausing while the host's agent is busy. Rejected for now. Model calls are remote, and embedding one memory is short; the importer's one-unit pace is enough. The runner can add a busy check later without changing the specs.

### D3. The cutoff

A new table `backfill_state(host TEXT PRIMARY KEY, cutoff INTEGER NOT NULL, state TEXT, model TEXT, counts TEXT, error TEXT, updated_at INTEGER)` lives in `import-ledger.db`, next to the ledger, so it moves with the store. The first run inserts `cutoff = Date.now()`; later runs read it. The run passes the cutoff as `until`, so turns after it are held back and left to live capture. Turns that have no timestamp are included, as they are today.

Alternative: no cutoff, relying only on the live-capture skip (D7). Rejected: a session that is open while the backfill runs would race with live capture for its newest turns.

### D4. One run per host across processes

The runner claims one row per host in `backfill_locks(host TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)` inside `import-ledger.db`. A new row is inserted only if absent. A stale row is replaced with one conditional update that matches its old PID and token; only one competing process can succeed. Releasing deletes only the row with the owner's token. A crashed process leaves a row that another process can reclaim after checking PID liveness. Each database write is brief; no transaction stays open during model calls or memory operations. The lock helper is asynchronous, and a process that fails to claim the row returns without a run. A module-level flag, shared with the session import commands, also prevents an automatic run from starting while a manual import runs in the same process.

### D5. Model resolution

`opencodeBackfillModel` and `piBackfillModel` hold `inherit` or `provider/model`.

- **Pi.** `provider/model` → `resolveImportModel(ctx, value)`, wrapped by `createPiCaptureProvider` and `adaptPiProfileModel`, as the Pi import command does. `inherit` → `createPiLiveModels(ctx)`, which already applies the live-model rule (host model, external API, then session model).
- **OpenCode.** `provider/model` → `createOpencodeImportModels`, after the provider list has loaded and the provider is connected. `inherit` follows `getAutoCaptureProviderStatus(CONFIG)`: `opencode` mode uses `opencodeProvider`/`opencodeModel`, `manual` mode uses `selectImportModel({})`, and `session` mode uses OpenCode's configured default model from `client.config.get()`, because no session exists yet at plugin start.

When no model resolves, the run records state `failed` with the reason and makes no model call. Parsing and validation of the two keys live in a small pure module, `src/importer/backfill-model.ts`, which takes `CONFIG` as an argument (config stubs in tests do not carry new exports).

### D6. Status

The status row in `backfill_state` holds the state, the model as `provider/model`, the counts (imported, skipped, failed, pending, unresolved sessions) as JSON, the cutoff, the last error passed through `safeHealthError` so keys are removed, and the update time. It holds no prompt text. A new endpoint, `GET /api/settings/backfill`, returns both hosts' rows; it has no side effects, like the imports readiness check. The notices use the host's existing notify paths (Pi `ctx.ui.notify`, OpenCode toast).

### D7. Skipping exchanges live capture already saved

Before each exchange, the importer asks the memory store for user IDs from non-import memories in that session's project shards with the same `host` and `hostSessionId`. For Pi, the helper reads `promptId` as well as `sourceEntryIds`, since existing live captures store the user entry ID only in `promptId`. For OpenCode, it reads user message IDs from `sourceEntryIds`; including `promptId` also covers existing memories that use that field. A unit whose user ID is in the set is recorded as `skipped` with reason `live-captured`, so later runs do not ask again. The importer refreshes the IDs before each exchange, because live capture may save a later exchange while an import processes the same session. The read-only helper lives in `src/services/` and is used by `importer.ts` and `opencode-import.ts`, so every surface gets it. The existing deduplication and ledger checks remain in place; a capture that lands after the refreshed read can still race with persistence. A dry run reports these units as skipped and never writes the ledger.

Alternative: rely on the web page's manual deduplication. Rejected, because most users never run it and duplicates would reach retrieval.

### D8. The login item

`src/services/web-autostart.ts` is host-neutral and exports `reconcileWebAutostart()`, `installWebAutostart({ start })`, `removeWebAutostart()`, and `webAutostartStatus()`. The item always runs `<runtime> <package>/dist/cli/index.js web --login-item`.

- **Runtime.** The item needs a JavaScript runtime. `process.execPath` is used when its base name is `node` or `bun`. Otherwise, as in OpenCode, whose executable is the OpenCode binary, the absolute paths of `node` and then `bun` on `PATH` are used. When neither exists, the status is `no-runtime` and nothing is written.
- **Package path.** The package root is found by walking up from the module's own URL to the `package.json` named `om-memory-system`. The item is rewritten when the runtime or package path differs from the one it holds. This is the check that keeps the item working after an update.
- **macOS.** `~/Library/LaunchAgents/io.github.cmdaltctr.omms.web.plist` with `RunAtLoad` true and `KeepAlive` false, stdout and stderr to `/dev/null` (the OMMS log is the record). A reconcile only writes or deletes the file, so the web app starts at the next login. `web install` also runs `launchctl bootstrap gui/<uid>` to start it now; `web uninstall` runs `launchctl bootout` first.
- **Linux.** `~/.config/systemd/user/omms-web.service`, enabled with `systemctl --user enable`. `web install` also starts it. When `systemctl --user` is not available, the status is `unsupported`.
- **Windows.** `omms-web.cmd` in the user's Startup folder, which starts the runtime minimised.

Hosts call `reconcileWebAutostart()` at start in the background. It installs when both `webServerAutoStart` and `webServerEnabled` are true, and removes the item otherwise. It is skipped when `OMMS_DISABLE_WEB_AUTOSTART` is set, which `.env.test` sets. Failures are logged with a code, never thrown.

Alternative: a background daemon started by the plugin itself. Rejected, because it would die with the host process and would not survive a reboot.

### D9. The `web` command

`src/cli/index.ts` gains `web [install|uninstall|status]`. Plain `web` calls `startWebServer` with the global config and the home directory as its project directory, prints the URL, and stays in the foreground until `SIGINT` or `SIGTERM`. `install` and `uninstall` save `webServerAutoStart` through `writeGlobalConfigKeys`, so the setting and the item agree and the next host start does not undo the command. The standalone server has no OpenCode provider list, so the Settings page's OpenCode model list and OpenCode-model imports report unavailable, as the existing readiness rules already describe for a missing host.

### D10. Settings and defaults

`src/config.ts` gains `autoBackfill` (default `true`), `opencodeBackfillModel` and `piBackfillModel` (default `inherit`), and `webServerAutoStart` (default `true`), with validation: booleans, and `inherit` or `provider/model` with non-empty parts. All four are read from the global config only, like `captureTraceRetentionDays`. The config template documents them. `global-config-writer.ts` and `settings-snapshot.ts` add them to their editable lists.

### D11. The Settings page

`web/src/lib/components/settings/` gains `AutoImportSection.tsx` and `WebAppSection.tsx`, placed after the Import section. The backfill model picker reuses the model list from `ModelsSection` for each host. The section polls `GET /api/settings/backfill` every 3 seconds while a host's state is `running`. All new strings go into every language file.

## Risks / Trade-offs

- [The first start after the upgrade makes thousands of model calls on the user's account.] → The start notice names the count, the model, and the switch. The backfill model setting lets users pick a cheaper model. The failure breaker stops a run whose model keeps failing.
- [A login item appears without the user asking.] → The user asked for it as a default. It is logged, shown in Settings with its status, and removed by one switch or `web uninstall`. OMMS only touches its own fixed-name item.
- [The login item's runtime path goes stale, for example after a Node upgrade through a version manager.] → Every host start rewrites the item when the paths differ; `web status` shows the paths.
- [Two processes run the backfill for one host.] → The lock plus ledger idempotency. Even if the lock failed, the ledger's in-progress reconciliation prevents duplicate memories.
- [Embedding load slows an active session.] → One unit at a time. If users report slowdowns, D2 leaves room for a busy check without spec changes.
- [OpenCode `inherit` in session mode uses the configured default model, which can differ from what the user picks per session.] → The Settings page shows the model the backfill uses, and the user can set `opencodeBackfillModel`.

## Migration Plan

1. Release as a minor version with a `feat:` commit; the proposal marks the default-on behaviour as a behaviour change, and the release notes call it out.
2. On the first host start after the update: the login item is installed, the cutoff is recorded, and the backfill starts after 30 seconds.
3. Rollback: set `autoBackfill` and `webServerAutoStart` to `false` (or run `om-memory-system web uninstall`). Downgrading leaves the `backfill_state` table and the login item in place; `web uninstall` from the new version, or deleting the plist/unit/cmd file, removes the item.
