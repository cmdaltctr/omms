# Claude Code Historical Session Import

Import your existing Claude Code transcripts into the shared memory store.
OMMS only reads the transcript files. It never changes them.

- By default, OMMS also imports older sessions automatically after a Claude Code session starts. See [Automatic import](#automatic-import).
- The terminal command below gives you a manual preview and control over scope and maps.
- The Settings page has the same import. See [Web import](#web-import).

Claude Code has no in-session command surface, so there is no slash command.
Every Claude Code import uses the external API. See
[Claude Code adapter: The external API is required](claude-code-adapter.md#the-external-api-is-required).

Verified against Claude Code 2.1.284.

## Quick start

1. Go to the project folder you want to import for.
2. Run a dry run. It reports what would happen, makes no model calls, and writes nothing.

   ```bash
   cd ~/code/my-project
   om-memory-system import-claude-history --dry-run
   ```

3. When the numbers look right, run the import with the saved external API.

   ```bash
   om-memory-system import-claude-history
   ```

By default:

- OMMS reads transcripts from `<Claude folder>/projects`. The Claude folder is the **Claude Code folder** setting (`claudeConfigDir`) when it is set, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. Live capture uses the same folder. `--root` overrides it for one import.
- Only sessions recorded for the current project are imported.
- Extraction and profile learning use the saved external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`).

To use another external model for one run, pass its settings. Keep the key in
an environment variable, never on the command line:

```bash
export OMMS_IMPORT_KEY='your-key'
om-memory-system import-claude-history --scope all-projects \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

Before a real import starts, the command prints `Import model: provider/model`.

## Command reference

`import-claude-history` takes the same options as the other terminal imports.
The full table is in [cli.md](cli.md#import-options). Only the source flag
differs: Claude Code reads its transcripts from `--root`.

```text
om-memory-system import-claude-history [options]

  --dry-run                 Preview counts; no model calls or writes
  --model <id>              Model id (default: saved memoryModel)
  --provider <type>         Provider type (default: saved memoryProvider)
  --api-url <url>           Endpoint; required when --provider differs from the saved one
  --api-key-env <name>      Read the API key from this environment variable
  --scope <scope>           current-project (default) or all-projects
  --project <dir>           Project for current-project scope (default: working directory)
  --session <id>            Import one session
  --since <date>            Inclusive start (ISO 8601 or epoch ms)
  --until <date>            Inclusive end; a bare date covers the whole day
  --max-sessions <n>        Read at most n sessions, oldest first
  --map <old>=<new>         Map a recorded directory that no longer exists (repeatable)
  --root <dir>              Claude Code transcripts folder (default ~/.claude/projects)
  --skip-memories           Record profile prompts only
  --skip-profile            Import memories only
  --profile-batch <n>       Prompts per profile analysis batch (default: 50)
  --force                   Reprocess already-handled memory work units
  --help                    Show this help
```

- `--root` can be the projects folder, one project folder, or one `.jsonl` transcript.
- `--session` takes a session ID or a transcript file path.
- `--db` is an error on this command.
- A value may follow its flag or use `--flag=value`. Quote values that contain spaces.
- `--since` and `--until` filter on each prompt's timestamp. Both are inclusive.

A dry run over every project:

```bash
om-memory-system import-claude-history --dry-run --scope all-projects
```

The report has the same format as the other hosts:

```text
Claude Code history import (dry-run)
  sessions: 118/120 loaded, 0 filtered out
  memory units: 640 pending, 0 already done, 0 imported, 0 skipped, 0 failed
  project /Users/me/code/my-project: 40 sessions, 210 units
  unresolved /Users/me/old-worktree: 3 sessions, 9 units (use --map)
  profile prompts: 640 pending, 0 recorded, 0 already done; 0 batches, 0 remaining
```

## Automatic import

When `autoBackfill` is on, the web app runs the Claude Code backfill. It
starts after the first Claude Code `SessionStart` that reaches the web app
after the web app starts.

1. The web app waits about 30 seconds.
2. It saves a cutoff for Claude Code on the first run.
3. It imports earlier turns across projects whose directories resolve.

- The web app tries the backfill once per process. A second session start does not start a second run.
- It skips turns that live capture already saved. It checks the recorded user entry ID and assistant entry IDs.
- Later runs resume pending work with the same cutoff and ledger.
- Live capture handles newer turns.
- The import makes model calls. Preview by hand before a large extra import.
- To stop the automatic run, set `"autoBackfill": false` in the global config.

The Claude Code backfill always uses the external API. There is no
`claudeBackfillModel` setting.

- When the external API is not fully configured, the run does not start. The status names the missing setting, for example `memoryApiUrl`.
- The web app does not try again by itself. Set up the external API, then select **Run now**, or restart the web app.

On the Settings page you can:

- See the Claude Code backfill state, pending counts, cutoff, and errors.
- **Run now**, **Pause**, and **Resume** the backfill. The routes are `POST /api/settings/backfill/claude-code/run`, `/pause`, and `/resume`.
- Manage saved directory maps (`importPathMaps`) in **Directory maps**. Saved maps also apply to the automatic import.

A paused backfill stays paused across Claude Code sessions until you resume
it. One Claude Code import runs at a time, whether from a backfill, the page,
or the terminal. A second one stops with `A Claude Code import is already running`.

See [Web UI settings](web-ui-settings.md) for details.

## Web import

The Settings page's **Import and backfill** section can import Claude Code
history. See [Web UI settings: Import and backfill](web-ui-settings.md#import-and-backfill).

- Choose **Claude Code** as the history host.
- The default source is the projects folder that live capture uses: from the **Claude Code folder** setting, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. The folder picker opens there. The source kind is `claude-projects`. A Claude Code source must be a folder.
- **List sessions** shows each session's date, ID, and project folder.
- The import model is always the saved external API. A request for any other model is refused with `Claude Code imports use the external API`.
- Import readiness has a `claudeCode` entry. It shows the default folder and whether it exists. The reader ships with OMMS, so it is always available.

## How windows are built

A window is one work unit: one user prompt with the work that followed it.
The reader is in `src/importer/claude-conversation.ts`. Live capture uses the
same reader.

1. OMMS finds `.jsonl` files in the root and in its direct sub-folders. It does not read deeper folders, so subagent transcripts (`<session-id>/subagents/*.jsonl`) are not sessions.
2. For each file, it reads up to the first user entry. That entry gives the session ID, the working directory, and the date.
3. The recorded working directory (`cwd`) resolves through the same project identity as live capture. The folder name under `~/.claude/projects` is not used.
4. A user entry starts a new window when it is in the main chain, is not a meta entry, and holds no tool result.
5. The window collects the assistant text and the tool calls with their inputs until the next such user entry.
6. A window with no assistant text and no tool call is dropped.
7. Every window goes through the live-capture pipeline: privacy filter, extraction, deduplication, embedding, and storage.
   - Provenance records `host=claude-code`, `sourceType=history-import`, the session ID, the source file, the entry IDs, and the prompt timestamp.
8. Each past user prompt is recorded once for profile learning. The importer analyses new prompts in batches.
   - `--skip-profile` leaves out these steps.
   - A dry run reports pending prompts without recording or analysing them.

A typed slash command becomes a prompt in the form `/name args`.

## Skipped entries

The reader never turns these into prompts:

| Entry                                                                   | What happens                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Sidechain entries (`isSidechain: true`), from subagents                 | Skipped. They do not start a window or add to the parent turn.  |
| Meta entries (`isMeta: true`), context that Claude Code adds            | Skipped. They do not end the current turn.                      |
| Tool results                                                            | Skipped. They do not end the current turn.                      |
| Thinking blocks                                                         | Left out of the window.                                         |
| Claude Code's own messages: command output, bash mode, and task notices | They end the current turn, but never start one.                 |
| Entries of an unknown type                                              | Skipped and counted.                                            |
| Lines that are not JSON                                                 | Counted as unreadable. The reader continues with the next line. |
| Files with no user entry, or files that cannot be read                  | Counted as unrecognised files and skipped.                      |

Tool inputs are cut to 100 characters, the same as the other hosts.

## Idempotency and recovery

Each work unit gets a fixed key:
`claude-code:<session-id>:<user-entry-id>:<last-entry-id>`. The ledger in the
store (`import-ledger.db` in the storage path) records imported, skipped, and
failed states.

- Import twice: the second run processes nothing.
- A turn that live capture already saved is skipped as `live-captured`.
- Extraction skips are final. Non-technical units never cost model calls again.
- Failures can be retried. Fix the cause and run again.

To inspect the ledger:

```bash
sqlite3 ~/.omms/data/import-ledger.db \
  "SELECT status, COUNT(*) FROM import_ledger WHERE key LIKE 'claude-code:%' GROUP BY status"
```

## Unresolvable directories

Sessions recorded in folders that no longer exist are skipped and listed in
the report. To import them into the project they belonged to:

```text
--map /old/deleted-worktree-path=/current/main-repo-path
```

- The map target must exist.
- Repeat `--map` for more paths.
- To keep a map for later imports and the automatic backfill, save it in `importPathMaps` or on the Settings page.

## Cost

- One model call per work unit, plus one per profile batch.
- Non-technical units return `skip` after one call.
- Run `--dry-run` first. It reports the unit count per project and pending profile prompts before any spend.

## Format changes

The transcript format is internal to Claude Code. A new Claude Code version
can add entry types or change fields.

- Fixture transcripts in `tests/fixtures/claude-transcripts/` pin the 2.1.284 format.
- Unknown entry types and unreadable lines are skipped, not fatal.
- If a new version produces far fewer units than expected, open an issue with the Claude Code version.
