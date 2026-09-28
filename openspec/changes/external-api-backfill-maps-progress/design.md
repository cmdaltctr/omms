# Design

## Context

See proposal.md for the motivation and the specs for the required behaviour. The current code shapes the approach in these ways:

- `src/services/ai/live-model-choice.ts` holds the live-model rule as pure functions of the config. `inherit` is the only special host model value. `parseBackfillModel` in `src/importer/backfill-model.ts` accepts `inherit` or `provider/model`.
- `memoryApiKey` is resolved once, when the config loads, by `resolveSecretValue` (`src/services/secret-resolver.ts`), which supports literal, `env://NAME`, and `file://path`. A login item started by launchd, systemd, or the Windows Startup folder does not load a shell profile, so `env://` names set only in `~/.zshrc` do not resolve there.
- `src/services/global-config-writer.ts` edits `omms.jsonc` with `jsonc-parser`, keeps comments, checks a revision, and only writes keys in an allow-list.
- `import-ledger.db` in the store already holds `import_ledger`, `backfill_state` (one row per host, numeric counts only), and `backfill_locks` (one row per host with the holder's PID and a token, replaced when the PID is gone). Manual imports use only an in-process guard (`manual-import-guard.ts`), so a CLI run and a host backfill can overlap today.
- `runHistoryImport` accepts `onProgress(processed, total, promptPreview)`. The total is known before the first model call.
- `resolveImportProject` takes an explicit map list and matches `from` exactly.
- The web server keeps one in-memory import job slot (`SettingsImportJobs`). Import readiness (`import-readiness.ts`) already reports whether the external API is usable in the server's process.

## Goals / Non-Goals

**Goals:**

- One model rule change, in one module, shared by both hosts, the importer, and the web server.
- One lock and one progress record per host that every surface (host backfill, web import, Run now, CLI, slash command) uses, so they cannot overlap and all show up on the page.
- Key values stay out of config, logs, traces, and responses.

**Non-Goals:**

- A menu bar or tray item.
- Showing or editing secrets other than `memoryApiKey`.
- Per-project directory maps or per-project external APIs.
- Changing the ledger's unit identity or the import report format.

## Decisions

### D1. `external` is a host model value, not a new key

`opencodeModel`, `piModel`, `opencodeBackfillModel`, and `piBackfillModel` accept `external`, like the existing `inherit`. `getAutoCaptureProviderStatus`, `resolveOpencodeHostModel`, and `resolvePiLiveModel` return the manual mode for `external` when the external API is ready and an unready status naming the missing settings when it is not. The fallback-on-failure path is skipped for `external`, because the external API is already the primary call. `parseBackfillModel` returns `"external"` as a third variant, and the backfill model resolvers on both adapters map it to the shared external provider.

Alternative: a new `opencodeModelSource`/`piModelSource` key. Rejected because it adds a second key that must agree with the first, and existing configs and the Settings cards already treat the model value as the switch (`inherit`).

### D2. Key sources and the private key file

The External API card sends one of three shapes: `{ source: "env", name }`, `{ source: "file", path }`, or `{ source: "paste", value, name }`. The server validates the name (`[A-Za-z_][A-Za-z0-9_]*`) or path, and for `paste` writes `~/.config/omms/secrets/<name>.key` with an exclusive create or, after confirmation, an atomic replace. Permissions: create the folder `700` and the file `600` on POSIX; on Windows, move the user-only ACL code that protects capture traces out of `src/services/capture-diagnostics.ts` into a shared module and use it for both. The config gets `file://` with the absolute path. An `env://` or `file://` key that does not resolve in a process is treated as not set there (`resolveMemoryApiKey` in `src/config.ts`) instead of stopping the config from loading, so a login web app without the variable still starts and reports the key as missing. The request body is never logged; error messages go through the existing API key redaction. The global config writer gains `memoryProvider`, `memoryApiUrl`, `memoryModel`, `memoryApiKey`, and `importPathMaps` in its allow-list, and rejects a `memoryApiKey` that is not an `env://` or `file://` reference.

Alternative: store the pasted key in the OS keychain. Rejected for now: it needs native code on three platforms, and `file://` already works in every OMMS process, including the login item.

The **Test** button builds the provider from the saved settings in the web server's process and sends one short prompt with a small output limit, reusing the Health section's model test.

### D3. Saved maps merge before resolution

`importPathMaps` is an array of `{ from, to }`, global only. Paths are expanded (`~`) and normalised by the config loader. `run-import.ts` builds the run's map list as the saved maps with run maps (`--map` or the web request's maps) applied on top by `from`, then passes it to the existing `resolveImportProject`. Resolution rules do not change.

Unresolved directories come from the import report and from the page's session listing. They are stored per host in their own `unresolved_directories` table in `import-ledger.db` (paths and session counts only, capped at 200 entries), so the page can show them without running a listing. They are not stored in the `backfill_state` row, because creating that row fixes a host's backfill cutoff, and a listing must not do that. Suggestions are computed on request by the web server:

1. For each ancestor of the missing directory, from the directory itself upwards, take its name and find the longest existing sibling of that ancestor, or the longest existing directory under the user's other recorded project roots, whose name is a prefix of that name ending at a `-` or `/` boundary and which is a Git repository or has a project marker. For `~/orca/workspaces/app/feat-x` this also tries the segment `app` against known project roots.
2. For OpenCode sessions, the project `worktree` recorded in OpenCode's `project` table, read through the existing read-only reader.

Only existing directories are suggested. Nothing is saved until the user saves.

### D4. One run record and one lock for every surface

A new `import_runs` table in `import-ledger.db` has one row per host: `host`, `surface` (`auto`, `web`, `cli`, `slash`), `state`, `pid`, `started_at`, `total`, `done`, `imported`, `skipped`, `failed`, `error`, `updated_at`, a JSON array of recent `(time, done)` samples (last 20), and `paused`. The existing `backfill_state` row stays for the cutoff and backfill-specific fields; the page reads both.

Every model-calling run acquires the existing `backfill_locks` row for its host before it starts (today only automatic backfill does), updates `import_runs` from `onProgress` at most once a second, and releases the lock in `finally`. `promptPreview` is never stored. A run whose PID is gone is reported as stopped. This replaces the in-process `manual-import-guard` as the cross-process guard; the guard stays for the in-process fast path.

Progress counts only units that need a model call. The importer reports each unit as it starts, with the number of ledger hits so far; `workProgress` in `import-progress.ts` turns that into finished work units. A backfill passes its dry-run count as the fixed total. Samples are taken at most every 15 seconds, so the 20-sample window spans about 5 minutes.

Time left is `(total - done) / rate`, where `rate` is units per minute across the sample window, and is shown only after 5 samples spanning at least 60 seconds.

Alternative: parse the CLI's printed report. Rejected: a second process cannot read another process's stdout, and the store is already the shared place both processes use.

### D5. Pause, resume, and Run now

`paused` is a flag on the host's `import_runs` row. Pause sets it and aborts the running job's `AbortController` when the run is in the web server's process. When the run is in another process (a host or the CLI), that process checks the flag between exchanges, the same way it checks `autoBackfill` today, and stops. Host start-up skips the automatic run while the flag is set. Resume clears the flag, then behaves like Run now.

Run now starts the host's backfill inside the web server process using `scheduleAutoBackfill` with no start-up delay and the `web` surface. In the login web app there is no host runtime, so it is available only when the host's backfill model resolves to `external`; otherwise the endpoint answers with the reason. Inside an OpenCode-served web app, OpenCode's connected models remain available for the OpenCode backfill. Pi's backfill needs the Pi SDK for reading sessions, which the web server already loads for Pi imports (`piReader` readiness).

### D6. `--version` and the version check

`src/cli/index.ts` handles `--version` and `-v` by printing the version from the package's `package.json`. The web server finds `om-memory-system` on its own `PATH`, runs it with `--version` and a 3-second timeout without a shell (the pattern used by the Windows Git wrapper fix), caches the result for 10 minutes, and compares it with its own version.

## Risks / Trade-offs

- [A login web app still cannot see `env://` keys] → The card says so and suggests a key file; readiness reports the key as missing in that process.
- [A pasted key lands on disk] → User-only permissions, a dedicated folder, no logging, and the same trust model as the existing `file://` support. Saving a pasted key is refused on a network-bound server without Basic Auth.
- [`external` hides fallback] → A failure of the external API is not retried elsewhere. The capture attempt log records the failure, as it does for other failures.
- [Suggestions can be wrong] → They are only suggestions; the user confirms each map, and imports never apply an unconfirmed suggestion.
- [Progress writes add store traffic] → Throttled to one write a second per run, and only numbers are written.
- [A crashed run leaves a running row] → PID liveness turns it into stopped; the lock is already replaced the same way.
- [A CLI run started before the upgrade has no progress row] → Only runs from the new version report progress; older runs still write the ledger.

## Migration Plan

- New config keys are optional; existing configs behave as before.
- `import_runs` is created on first use with `CREATE TABLE IF NOT EXISTS`; older versions ignore it.
- Rolling back to an older version: `external` values would fail validation there, so the rollback note in the changelog tells users to switch those settings back first. Saved key files and `importPathMaps` are ignored by older versions.

## Open Questions

- The exact wording and layout of the Directory maps list and the suggestion controls can be settled during implementation without changing the specs.
