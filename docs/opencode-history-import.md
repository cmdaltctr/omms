# Import OpenCode history

Import past OpenCode V1 conversations into OMMS memories and the user profile. The importer reads OpenCode's SQLite database without changing it. OpenCode can stay open. When the database has a write-ahead log, the importer reads a temporary copy of the database and its log, so recent turns are included, and deletes the copy when it finishes.

## Quick start

Inside OpenCode, in the project you want to import, run a preview:

```text
/memory-import-opencode-history --dry-run
```

The preview reports sessions, work units, profile prompts and unresolved directories. It makes no model calls and writes no store files. Check the counts and directory mappings, then import:

```text
/memory-import-opencode-history
```

The command uses this session's model through OpenCode's own sign-in, so no OMMS API key is needed. To use a different, cheaper model for the import, name one from a connected provider:

```text
/memory-import-opencode-history --model openrouter/your-smaller-model
```

`--model` takes `provider/id`; everything after the first `/` is the model id. The session's own model stays unchanged. On the V1 plugin API, OpenCode runs one short turn with the session model to show the finished report.

By default only sessions recorded for the current project are imported. Add `--scope all-projects` to import every project. The importer uses `~/.local/share/opencode/opencode.db` by default; use `--db <path>` for another OpenCode V1 database. Run only one importer against the memory store at a time.

## From a terminal

The same import also runs outside OpenCode. It then has no session model, so it calls the external model configured in OMMS (`memoryProvider`, `memoryModel` and its credentials):

```bash
npx om-memory-system import-opencode-history --dry-run
npx om-memory-system import-opencode-history
```

To use a different external model for this run only, pass its settings. Keep the key in an environment variable, not in the command:

```bash
export OMMS_IMPORT_KEY='your-key'
npx om-memory-system import-opencode-history \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

`--api-url` is required when `--provider` differs from the saved provider. The terminal command prints `Import model: provider/model` before it starts. Pi history imports the same way with `import-pi-history`.

## Options

The OpenCode and Pi commands, in a session or a terminal, take the same options. A value may follow its flag or use `--flag=value`; quote values that contain spaces.

| Flag                                      | Effect                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `--dry-run`                               | Preview with no model calls or writes.                               |
| `--model <provider/id>`                   | In a session: use this connected model instead of the session's.     |
| `--scope <scope>`                         | `current-project` (default) or `all-projects`.                       |
| `--project <dir>`                         | Project for `current-project` scope. Default: the working directory. |
| `--session <id>`                          | Import one top-level session.                                        |
| `--since <date>`, `--until <date>`        | Include work units inside these dates, inclusive.                    |
| `--max-sessions <n>`                      | Read at most this many sessions, oldest first.                       |
| `--map <old>=<new>`                       | Remap a missing session directory. Repeat as needed.                 |
| `--db <path>`                             | Read this V1 SQLite database.                                        |
| `--skip-memories`                         | Record prompts and build the profile only.                           |
| `--skip-profile`                          | Import memories only.                                                |
| `--profile-batch <n>`                     | Analyse this many prompts per profile batch. Default: 50.            |
| `--force`                                 | Reprocess memory work units with final ledger states.                |
| `--help`                                  | Show command help.                                                   |
| `--provider`, `--model <id>`, `--api-url` | Terminal only: select an external model for this run.                |
| `--api-key-env <name>`                    | Terminal only: read this run's API key from an environment variable. |

Dates use ISO 8601 or epoch milliseconds. A bare date such as `2026-03-31` in `--until` covers that whole day. The importer does not save model choices to the configuration.

## How it works

1. The importer reads top-level sessions from the database, oldest first. If a
   `-wal` file exists, it reads a temporary copy of the database and its WAL,
   so turns OpenCode has not yet checkpointed are included. The copy is
   deleted afterwards. OpenCode's own files stay unchanged.
2. Child sessions (subagents) are folded into their parent. Sessions that OMMS
   created for its own model calls are skipped.
3. Each session's directory resolves to a project through the same project
   identity as live capture, so imported memories land in the namespace you
   already use (see Project resolution below).
4. Each user prompt becomes one work unit with its assistant text and tool
   inputs. Reasoning, synthetic parts and tool outputs are excluded; tool
   inputs are truncated.
5. Every unit flows through the live-capture pipeline: privacy filter,
   extraction, dedup, embedding and storage, with provenance `host=opencode`,
   `sourceType=history-import`, the session id, source file and timestamps.
6. Each past prompt is recorded once for profile learning, then analysed in
   batches to create or update your user profile.

The importer takes each session's recorded directory. If it still exists, that directory determines the project identity. For a deleted worktree, `--map` takes priority over OpenCode's recorded project worktree. A usable project worktree then provides a fallback. Unresolved directories appear in the report and are skipped. The root directory `/` is not a project fallback. Child sessions are folded into their parent session, rather than imported as separate conversations. Sessions that OMMS itself created for capture and profile calls are never imported.

## What replaces the old scripts

| Old script             | Built-in step                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| `backfill-memories.py` | Extract and store memories from past exchanges.                    |
| `backfill-profile.py`  | Record your past prompts for profile learning.                     |
| `build-profile.py`     | Analyse those prompts in batches and create or update the profile. |

The import runs all three steps by default. Each exchange can require one model call. Each profile batch can require another. The preview shows pending work units and profile prompts so you can estimate cost. `--skip-memories` and `--skip-profile` reduce the work when you only need one result.

## Cost

A real import makes one model call per work unit, plus one per profile batch.
Non-technical units return `skip` after one call. Embedding each stored memory
uses your embedding model (local, Ollama or remote), as live capture does.
Run `--dry-run` first: it reports units per project and pending profile
prompts before any spend.

## Rerun, recover and undo

The importer records work unit outcomes in `<storagePath>/import-ledger.db`. Rerunning skips handled memories and deduplicates profile prompts. Failed work remains retryable. If a process stops after a memory write but before a ledger update, the next run checks the stored import identifier and avoids a duplicate. A failed profile batch keeps its prompts for the next run.

There is no automatic undo command. Back up the OMMS data directory before a real import if you might need to roll back. Restore that backup to undo the import, including its memories, prompts, profile changes and ledger. Restoring also discards any newer OMMS data written since the backup. Do not delete ledger entries alone: a rerun can then create duplicate memories.

## Inspecting import status

The ledger lives at `<storagePath>/import-ledger.db`. Per-run counts appear in
the command report. For per-key inspection:

```bash
sqlite3 ~/.omms/data/import-ledger.db \
  "SELECT status, COUNT(*) FROM import_ledger WHERE key LIKE 'opencode:%' GROUP BY status"
```

See [cli.md](cli.md) for the terminal command and [opencode-adapter.md](opencode-adapter.md)
for how the plugin captures new work.
