# Import OpenCode history

Import past OpenCode V1 conversations into OMMS memories and the user profile.

- The importer reads OpenCode's SQLite database without changing it.
- OpenCode can stay open. When the database has a write-ahead log (WAL), the importer reads a temporary copy of the database and its log. Recent turns are then included. It deletes the copy when it finishes.

## Quick start

1. Open OpenCode in the project you want to import.
2. Run a preview. It reports sessions, work units, profile prompts, and unresolved directories. It makes no model calls and writes no store files.

   ```text
   /memory-import-opencode-history --dry-run
   ```

3. Check the counts and directory mappings.
4. Run the import.

   ```text
   /memory-import-opencode-history
   ```

The command uses this session's model through OpenCode's own sign-in, so you need no OMMS API key. To use a different, cheaper model, name one from a connected provider:

```text
/memory-import-opencode-history --model openrouter/your-smaller-model
```

- `--model` takes `provider/id`. Everything after the first `/` is the model id.
- The session's own model stays unchanged.
- On the V1 plugin API, OpenCode runs one short turn with the session model to show the finished report.

Other defaults:

- Only sessions recorded for the current project are imported. Add `--scope all-projects` to import every project.
- The importer reads `~/.local/share/opencode/opencode.db`. Use `--db <path>` for another OpenCode V1 database.
- One OpenCode import runs at a time. A second one stops with an "already running" message.

## Automatic import

By default, OMMS waits about 30 seconds after OpenCode starts. It then saves a cutoff for OpenCode and imports earlier turns across projects whose directories resolve.

- It skips exchanges that live capture already saved, by checking the stored entry IDs.
- Later starts resume pending work with the same cutoff and ledger. Live capture handles newer turns.
- It reads a private database snapshot while OpenCode is running.
- Use a manual command for custom databases, maps, or another date range.
- Automatic import makes model calls. To prevent it, set `"autoBackfill": false` in the global config before you start OpenCode.

`opencodeBackfillModel` chooses the backfill model:

- `"inherit"` (default) uses the configured OpenCode host model, then the saved external API, then OpenCode's configured default model.
- `"external"` uses the external API.
- `provider/model` uses another signed-in model for backfill only. The provider must be connected.
- A missing model records an error. It does not change the live-capture model.

On the Settings page you can:

- See the cutoff, progress, and errors.
- **Run now**, **Pause**, and **Resume** the backfill, and watch its progress bar and minutes left.
- Manage saved directory maps (`importPathMaps`) in **Directory maps**. The page suggests targets for unresolved directories. Saved maps also apply to the automatic import.

See [Web UI settings](web-ui-settings.md) for details.

- With `opencodeBackfillModel` set to `"external"`, **Run now** works in the login web app with no host open.
- A paused backfill stays paused across OpenCode starts until you resume it.
- One OpenCode import runs at a time, whether from a backfill, the page, a slash command, or the CLI.

## From a terminal

The same import runs outside OpenCode. It then has no session model, so it calls the external model saved in OMMS (`memoryProvider`, `memoryModel`, and its credentials):

```bash
npx om-memory-system import-opencode-history --dry-run
npx om-memory-system import-opencode-history
```

To use a different external model for one run, pass its settings. Keep the key in an environment variable, not in the command:

```bash
export OMMS_IMPORT_KEY='your-key'
npx om-memory-system import-opencode-history \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

- `--api-url` is required when `--provider` differs from the saved provider, except for `orcarouter`.
- The terminal command prints `Import model: provider/model` before it starts.
- Pi history imports the same way with `import-pi-history`.

## Options

The OpenCode and Pi commands take the same options, in a session or a terminal. [cli.md](cli.md#import-options) has the full table.

- A value may follow its flag or use `--flag=value`. Quote values that contain spaces.

| Flag                                | Effect                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `--dry-run`                         | Preview with no model calls or writes.                                                |
| `--model <provider/id>`             | In a session: use this connected model instead of the session's.                      |
| `--scope <scope>`                   | `current-project` (default) or `all-projects`.                                        |
| `--project <dir>`                   | Project for `current-project` scope. Default: the working directory.                  |
| `--session <id>`                    | Import one top-level session.                                                         |
| `--since <date>`, `--until <date>`  | Include work units inside these dates, inclusive.                                     |
| `--max-sessions <n>`                | Read at most this many sessions, oldest first.                                        |
| `--map <old>=<new>`                 | Remap a missing session directory for this run. Adds to `importPathMaps`. Repeatable. |
| `--db <path>`                       | Read this V1 SQLite database.                                                         |
| `--skip-memories`                   | Record prompts and build the profile only.                                            |
| `--skip-profile`                    | Import memories only.                                                                 |
| `--profile-batch <n>`               | Analyse this many prompts per profile batch. Default: 50.                             |
| `--force`                           | Reprocess memory work units and profile prompts with final ledger states.             |
| `--help`                            | Show command help.                                                                    |
| `--provider <type>`, `--model <id>` | Terminal only: choose an external provider and model id for this run.                 |
| `--api-url <url>`                   | Terminal only: the endpoint for this run.                                             |
| `--api-key-env <name>`              | Terminal only: read this run's API key from an environment variable.                  |

- Dates use ISO 8601 or epoch milliseconds.
- A bare date such as `2026-03-31` in `--until` covers that whole day.
- The importer does not save model choices to the configuration.

## How it works

1. The importer reads top-level sessions from the database, oldest first. If a `-wal` file exists, it reads a temporary copy of the database and its WAL. Turns that OpenCode has not yet checkpointed are then included. The copy is deleted afterwards. OpenCode's own files stay unchanged.
2. Child sessions (subagents) are folded into their parent. Sessions that OMMS created for its own model calls are skipped.
3. Each session's directory resolves to a project through the same project identity as live capture. Imported memories land in the namespace you already use. See [Project resolution](#project-resolution).
4. Each user prompt becomes one work unit with its assistant text and tool inputs. Reasoning, synthetic parts, and tool outputs are left out. Tool inputs are shortened.
5. Every unit goes through the live-capture pipeline: privacy filter, extraction, dedup, embedding, and storage. Provenance records `host=opencode`, `sourceType=history-import`, the session id, source file, and timestamps.
6. Each past prompt is recorded once for profile learning. It is then analysed in batches to create or update your user profile.

### Project resolution

The importer takes each session's recorded directory.

1. If the directory still exists, it sets the project identity.
2. For a deleted worktree, a `--map` or saved `importPathMaps` entry comes first.
3. Next, OpenCode's recorded project worktree is used, if it is usable.
4. Otherwise the directory is unresolved. It appears in the report and its sessions are skipped.

The root directory `/` is never a project fallback.

## What replaces the old scripts

| Old script             | Built-in step                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| `backfill-memories.py` | Extract and store memories from past exchanges.                    |
| `backfill-profile.py`  | Record your past prompts for profile learning.                     |
| `build-profile.py`     | Analyse those prompts in batches and create or update the profile. |

The import runs all three steps by default. Use `--skip-memories` or `--skip-profile` when you only need one result.

## Cost

- A real import makes one model call per work unit, plus one per profile batch.
- Non-technical units return `skip` after one call.
- Each stored memory is embedded with your embedding model (local or remote), as live capture does.
- Run `--dry-run` first. It reports units per project and pending profile prompts before any spend.

## Rerun, recover and undo

The importer records work unit outcomes in `<storagePath>/import-ledger.db`.

- A rerun skips handled memories and removes duplicate profile prompts.
- Failed work stays retryable.
- If a process stops after a memory write but before the ledger update, the next run checks the stored import identifier. It does not create a duplicate.
- A failed profile batch keeps its prompts for the next run.

There is no undo command. To be able to roll back:

1. Back up the OMMS data directory before a real import.
2. To undo the import, restore that backup. This removes its memories, prompts, profile changes, and ledger entries.

Restoring also removes any OMMS data written after the backup. Do not delete ledger entries on their own: a rerun can then create duplicate memories.

## Inspecting import status

The ledger is at `<storagePath>/import-ledger.db`. Each run's counts appear in the command report. To inspect each key:

```bash
sqlite3 ~/.omms/data/import-ledger.db \
  "SELECT status, COUNT(*) FROM import_ledger WHERE key LIKE 'opencode:%' GROUP BY status"
```

See [cli.md](cli.md) for the terminal command and [opencode-adapter.md](opencode-adapter.md) for how the plugin captures new work.
