# Pi Historical Session Import

Import your existing Pi session history into the shared memory store. The
import is explicit and read-only toward Pi: your session JSONL files are never
modified, and nothing imports until you run the command.

Verified against `@earendil-works/pi-coding-agent` 0.85.1.

## Quick start

From inside `pi`, in the project you want to import for:

```text
/memory-import-pi-history --dry-run
```

The dry-run reports what would happen and writes nothing. When the numbers
look right:

```text
/memory-import-pi-history
```

By default only sessions recorded for the current project are imported.

## Command reference

```text
/memory-import-pi-history [options]

  --dry-run                  Discover, map, and report; write nothing
  --force                    Reprocess units with terminal ledger states
  --scope=current-project    Import only sessions from this project (default)
  --scope=all-projects       Import every discovered session
  --session=<id-or-file>     Import one exact session
  --since=<date>             Only work units at/after this time
  --until=<date>             Only work units at/before this time
  --max-sessions=<n>         Limit discovery to the oldest n sessions
  --map=<oldPath>=<newPath>  Remap a recorded cwd that no longer exists
  --root=<dir>               Session root (default ~/.pi/agent/sessions)
```

Dates accept ISO 8601 (`2026-01-01`, `2026-01-01T10:00:00Z`) or epoch
milliseconds. `--since`/`--until` filter on each work unit's user-entry
timestamp, inclusive. Paths containing spaces are not supported in `--map`.

## How it works

1. Sessions are discovered under the session root. Only files with a Pi
   session header qualify; subagent artifacts and unrecognized formats are
   counted and skipped.
2. Each session loads through Pi's own `SessionManager.open`, which migrates
   legacy session versions in memory.
3. The recorded `cwd` in each session header resolves through the same project
   identity as live capture, so imported memories land in the same namespace
   you already use.
4. Each user prompt on the session's active branch becomes one work unit with
   its assistant and tool work. Hidden thinking, images, and tool outputs are
   excluded; tool inputs are truncated.
5. Every unit flows through the live-capture pipeline: privacy filter,
   extraction (through your active Pi model), dedup, embedding, persistence,
   with provenance `host=pi`, `sourceType=history-import`, session id, source
   file, entry ids, and timestamps.

## Idempotency and recovery

Each work unit gets a deterministic key:
`pi:<session-id>:<user-entry-id>:<assistant-terminal-entry-id>`. A durable
ledger inside the store (`import-ledger.db` in the storage path) records
imported, skipped, and failed states.

- Import twice: the second run processes nothing.
- Extraction skips are terminal: non-technical units never spend model calls
  again.
- Failures are retryable: fix the cause and rerun.
- Crash between the memory write and the ledger update: the rerun finds the
  stored `importId` and reconciles instead of duplicating.

## Unresolvable directories

Sessions recorded in directories that no longer exist (deleted worktrees, temp
dirs) are skipped and listed in the report. To import them into the project
they belonged to:

```text
--map /old/deleted-worktree-path=/current/main-repo-path
```

The map target must exist. Repeat `--map` for multiple paths.

## Cost

One model call per work unit. Non-technical units return `skip` after a single
call and never cost another. Run `--dry-run` first: it reports the exact unit
count per project before any spend.

## Inspecting import status

The ledger lives at `<storagePath>/import-ledger.db`. Status counts per run
appear in the command summary. For per-key inspection:

```bash
sqlite3 ~/.omms/data/import-ledger.db \
  "SELECT status, COUNT(*) FROM import_ledger GROUP BY status"
```

## Moving machines

The memory store is portable. To carry memories and import state to a new
machine:

1. Copy the whole data directory:

```bash
rsync -a ~/.omms/data/ newmachine:~/.omms/data/
```

2. Copy the config: `~/.config/omms/omms.jsonc` (on machines still on the
   legacy layout, `~/.config/opencode/opencode-mem.jsonc`).
3. Install the embedding runtime on the new machine and keep the model
   identical (for example `ollama pull qwen3-embedding:0.6b`). Stored vectors
   only match queries from the same embedding model.
4. Clone your repositories.

If the absolute project path is identical on the new machine, you are done.
If the username or layout differs, project tags change and memories appear
orphaned. Re-associate per project from inside that project:

```text
memory list-shards
memory migrate --from-path /old/machine/absolute/path
```

or `--from-hash <hash>` from the `list-shards` output. The old path does not
need to exist on the new machine. No re-embedding happens.

Pi session files move separately (`~/.pi/agent/sessions`). Because the import
ledger travels with the data directory, rerunning the import on the new
machine creates zero duplicates.
