# Proposal

## Why

Setting up an external model (for example a Z.ai GLM Coding Plan endpoint) today means editing `omms.jsonc` by hand, and that model can only act as a fallback: a host cannot choose it as its main capture or backfill model. History from deleted worktrees can only be imported with repeated `--map` flags on the CLI, because automatic backfill and the Settings page have no saved directory maps. Long imports show counts but no percentage or time left, and a CLI run is invisible on the page. The CLI guide also lacks a full command list and a global install step.

## What Changes

- Add an **External API** card to the Settings page. It edits `memoryProvider`, `memoryApiUrl`, `memoryModel`, and `memoryApiKey`. The user picks the key source:
  - **Environment variable**: types a variable name, saved as `env://NAME`.
  - **Key file**: types the path of an existing key file, saved as `file://path`.
  - **Save key to a private file**: pastes the key once. OMMS writes it to `~/.config/omms/secrets/<name>.key`, readable only by the user, and saves `file://` with that path. The key never goes into `omms.jsonc`, the log, or any response, and the page never shows it again.

  A **Test** button makes one small call and reports success or a redacted error. The card shows whether the key resolves in the web app's own process, and warns that a login web app does not see variables set only in a shell profile, so a key file suits the login web app.

- Let each host choose the external API as its model. The value `external` for `opencodeModel`/`piModel` sends live capture and profile learning to the external API; the same value for `opencodeBackfillModel`/`piBackfillModel` sends that host's backfill there. The model rule changes only in `live-model-choice.ts`, identically for both hosts.
- Add a saved directory map list, `importPathMaps`, in the global config. Automatic backfill, web imports, and CLI and slash-command imports all use it. A `--map` flag adds to it for that run and wins for the same source directory.
- On the Settings page, list the directories that cannot be resolved, with session counts and a suggested target where one can be found (for example, a deleted worktree's main repository). The user confirms, edits, or removes each map and saves.
- Record progress for every import run (automatic, web, and CLI) in the store: totals, done, percentage, and minutes left from the recent rate. The page shows a progress bar for each host and for a running CLI or web import.
- Add **Run now**, **Pause**, and **Resume** for each host's backfill on the Settings page. They work in the login web app without Pi or OpenCode open, using the external API. A paused backfill stays paused across host starts until the user resumes it.
- Add `om-memory-system --version`. The Web app section shows the global command's version and warns when it differs from the running OMMS version.
- Docs: a complete command reference in `docs/cli.md` (every terminal command and subcommand, and both hosts' slash commands), global install as optional but highly recommended (`npm i -g` or `bun add -g`, upgrading, checking the version) in `docs/web-ui.md` and the setup docs, and a note that terminal proxies such as Orca's `*.orca.localhost` addresses can differ from the printed `127.0.0.1` URL.

No breaking changes: existing configs keep their behaviour; `external` and `importPathMaps` are opt-in.

## Capabilities

### New Capabilities

- `import-directory-maps`: saved directory maps shared by every import surface, and suggestions for unresolved directories.
- `import-progress`: a progress record for every import run, with percentage and time left, and Run now, Pause, and Resume for backfills.

### Modified Capabilities

- `host-neutral-memory-core`: the live-capture model rule gains the `external` host model value.
- `auto-backfill`: backfill models accept `external`; backfill uses saved maps; a paused state survives host starts.
- `web-settings`: the External API card; the page may write a key reference or save a pasted key to a private key file, but never reads or shows a key value; the Automatic import section gains progress, maps, and run controls.
- `web-autostart`: the login web app can run a user-started backfill; `--version` and the version-mismatch warning.

## Impact

- Code: `src/services/ai/live-model-choice.ts`, `src/config.ts` (new keys and validation), `src/services/global-config-writer.ts` (editable keys), `src/importer/` (maps, progress record, backfill controls, suggestions), `src/services/backfill-state.ts`, `src/services/api-handlers.ts` and `web-server.ts` (new endpoints), `src/cli/index.ts` (`--version`), both host adapters (backfill model `external`, pause state), and the web UI Settings page.
- Store: new progress and control rows in `import-ledger.db`; no change to memory shards.
- Docs: `docs/cli.md`, `docs/web-ui.md`, `docs/configuration.md`, `README.md` setup, and the history import guides.
- Tests: model rule parity, config validation, map merging, progress maths, pause across restart, endpoint access control, and secret handling.
