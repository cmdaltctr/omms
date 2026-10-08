# Pi Historical Session Import

Import your existing Pi session history into the shared memory store. Pi session JSONL files stay unchanged.

- By default, OMMS also imports older sessions automatically after Pi starts. See [Automatic import](#automatic-import).
- The command below gives you a manual preview and control over scope and maps.

Verified against `@earendil-works/pi-coding-agent` 0.86.1.

## Quick start

1. Open `pi` in the project you want to import for.
2. Run a dry run. It reports what would happen and writes nothing.

   ```text
   /memory-import-pi-history --dry-run
   ```

3. When the numbers look right, run the import.

   ```text
   /memory-import-pi-history
   ```

By default:

- Only sessions recorded for the current project are imported.
- Extraction uses this session's current model. The `piProvider` and `piModel` settings apply to live capture only.

To import with another model from Pi's model list, without changing the session's model:

```text
/memory-import-pi-history --model zai/your-smaller-model
```

The same import runs from a terminal with an external model and API key. See [cli.md](cli.md).

```bash
npx om-memory-system import-pi-history --dry-run
npx om-memory-system import-pi-history --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

## Automatic import

On the first Pi start, OMMS waits about 30 seconds. It then saves a cutoff for Pi and imports earlier turns across projects whose directories resolve.

- It skips turns that live capture already saved. It checks the recorded Pi prompt ID and assistant entry IDs.
- Later Pi starts resume pending work with the same cutoff and ledger.
- Live capture handles newer turns. Use the command for custom sources, maps, or another date range.
- The import makes model calls. Preview by hand before a large extra import.
- To stop the automatic run, set `"autoBackfill": false` in the global config.

`piBackfillModel` chooses the backfill model:

- `"inherit"` (default) follows Pi's live-capture model rule.
- `"external"` uses the external API.
- `provider/model` chooses a signed-in Pi model for backfill only.
- The setting does not change the slash command's model.

On the Memory page you can:

- See the state, pending counts, cutoff, and errors.
- **Run now**, **Pause**, and **Resume** the backfill, and watch its progress bar and minutes left.
- Manage saved directory maps (`importPathMaps`) in **Resolve missing project folders**. Suggestions need review before saving. Global maps apply to every host's next import.

See [Memory: Automatic import](web-ui-memory.md#automatic-import) for details.

- With `piBackfillModel` set to `"external"`, **Run now** works in the login web app with no host open.
- A paused backfill stays paused across Pi starts until you resume it.
- One Pi import runs at a time, whether from a backfill, the page, a slash command, or the CLI.

## Web import

Open **Memory → Import chat history** at `/memory#memory-section-import`. A new form selects Pi, Current project and both **Project memories** and **User profile**. Profile learning finds preferences, patterns and workflows. Deselect either output to skip it; at least one must remain selected.

Choose additional hosts or select **All hosts** explicitly. Project scope remains separate. List and select sessions for each host, choose models, preview the current draft, then confirm **Start import** and its model calls. Web imports use the saved external API or an available connected OpenCode model; Pi sign-in alone supplies no web model.

The server completes Pi's memory and profile phases before OpenCode, then Claude Code. Failure stops later hosts. Cancellation keeps completed work and prevents queued hosts from starting. Retry with refreshed lists and a fresh preview; existing ledgers skip completed work. A server restart ends the group and requires another preview and confirmation.

Historical host badges describe latest import coverage. They remain separate from the current group's success or failure. See [Memory: Import chat history](web-ui-memory.md#import-chat-history) for pinned selections, call estimates and results. CLI and in-session commands below remain unchanged.

## Command reference

The Pi and OpenCode commands take the same options. The full table is in [cli.md](cli.md#import-options).

- Pi reads its sessions from `--root <dir>`. OpenCode takes `--db` instead.
- A value may follow its flag or use `--flag=value`. Quote values that contain spaces.

```text
/memory-import-pi-history [options]

  --dry-run                  Discover, map, and report; write nothing
  --model <provider/id>      Use another Pi model (default: this session's model)
  --scope <scope>            current-project (default) or all-projects
  --project <dir>            Project for current-project scope (default: working directory)
  --session <id-or-file>     Import one exact session
  --since <date>             Only work units at/after this time
  --until <date>             Only work units at/before this time; a bare date covers the day
  --max-sessions <n>         Read at most n sessions, oldest first
  --map <oldPath>=<newPath>  Remap a recorded cwd that no longer exists (repeatable)
  --root <dir>               Session folder or one .jsonl file (default ~/.pi/agent/sessions)
  --skip-memories            Record profile prompts only
  --skip-profile             Import memories without profile learning
  --profile-batch <n>        Prompts per profile analysis batch (default: 50)
  --force                    Reprocess units and profile prompts with final ledger states
  --help                     Show this help
```

- Dates accept ISO 8601 (`2026-01-01`, `2026-01-01T10:00:00Z`) or epoch milliseconds.
- `--since` and `--until` filter on each work unit's user-entry timestamp. Both are inclusive.

## How it works

1. OMMS finds sessions under the session root. Only files with a Pi session header count. It counts and skips subagent files and unknown formats.
2. Each session loads through Pi's own `SessionManager.open`. This updates old session versions in memory.
3. The recorded `cwd` in each session header resolves through the same project identity as live capture. Imported memories land in the namespace you already use.
4. Each user prompt on the session's active branch becomes one work unit, with its assistant and tool work. Hidden thinking, images, and tool outputs are left out. Tool inputs are shortened.
5. Every unit goes through the live-capture pipeline: privacy filter, extraction, dedup, embedding, and storage.
   - Extraction uses this session's model unless you set `--model`.
   - Provenance records `host=pi`, `sourceType=history-import`, the session id, source file, entry ids, and timestamps.
6. Each past user prompt is recorded once for profile learning. The importer analyses new prompts in batches and creates or updates your user profile.
   - `--skip-profile` leaves out these steps.
   - A dry run reports pending prompts without recording or analysing them.

About `--model`:

- It uses Pi's model registry. Choose an available model as `provider/id`.
- The same model handles memory extraction and profile analysis for this run.
- The session's model stays unchanged.
- An unknown model stops the import before any processing.

## Idempotency and recovery

Each work unit gets a fixed key: `pi:<session-id>:<user-entry-id>:<assistant-terminal-entry-id>`. A ledger in the store (`import-ledger.db` in the storage path) records imported, skipped, and failed states.

- Import twice: the second run processes nothing.
- Extraction skips are final. Non-technical units never cost model calls again.
- Failures can be retried. Fix the cause and run again.
- If a crash happens between the memory write and the ledger update, the next run finds the stored `importId`. It reconciles instead of duplicating.

## Unresolvable directories

Sessions recorded in directories that no longer exist (deleted worktrees, temp folders) are skipped and listed in the report. To import them into the project they belonged to:

```text
--map /old/deleted-worktree-path=/current/main-repo-path
```

- The map target must exist.
- Repeat `--map` for more paths.
- To keep a map for every later import and automatic backfill, save it in `importPathMaps` or Memory's **Resolve missing project folders**.
- A `--map` for the same directory wins for that run.

## Cost

- One model call per work unit, plus one per profile batch.
- Non-technical units return `skip` after one call.
- Run `--dry-run` first. It reports the unit count per project and pending profile prompts before any spend.

## Inspecting import status

The ledger is at `<storagePath>/import-ledger.db`. Each run's counts appear in the command summary. To inspect each key:

```bash
sqlite3 ~/.omms/data/import-ledger.db \
  "SELECT status, COUNT(*) FROM import_ledger WHERE key LIKE 'pi:%' GROUP BY status"
```

## Moving machines

The memory store is portable. To move memories and import state to a new machine:

1. Copy the whole data directory.

   ```bash
   rsync -a ~/.omms/data/ newmachine:~/.omms/data/
   ```

2. Copy the config: `~/.config/omms/omms.jsonc`. On the legacy layout, copy `~/.config/opencode/opencode-mem.jsonc`.
3. Copy any key files your config points to, such as `~/.config/omms/secrets/`.
4. Keep the embedding model the same. Stored vectors only match queries from the same embedding model.
5. Clone your repositories.

If the absolute project path is the same on the new machine, you are done.

If the username or layout differs, project tags change and memories look orphaned. Link them again from inside each project:

```text
memory list-shards
memory migrate --from-path /old/machine/absolute/path
```

- You can use `--from-hash <hash>` from the `list-shards` output instead.
- The old path does not need to exist on the new machine.
- No re-embedding happens.

Pi session files (`~/.pi/agent/sessions`) move separately. The import ledger moves with the data directory, so running the import again on the new machine creates no duplicates.
