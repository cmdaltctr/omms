# Import OpenCode history

Import past OpenCode V1 conversations into OMMS memories and the user profile. The importer reads OpenCode's SQLite database without changing it. OpenCode can stay open.

## Quick start

Run a preview from any directory:

```bash
npx om-memory-system import-opencode-history --dry-run
```

The preview reports sessions, work units, profile prompts and unresolved directories. It makes no model calls and writes no store files. Check the counts and directory mappings before a real import:

```bash
npx om-memory-system import-opencode-history
```

The command uses `~/.local/share/opencode/opencode.db` by default. Use `--db <path>` for another OpenCode V1 database. The real import needs an external model configured in OMMS. Set `memoryProvider`, `memoryModel` and its credentials in the OMMS configuration, or pass model flags below. Run only one importer against the memory store at a time.

## Options

| Flag                                                   | Effect                                                    |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `--dry-run`                                            | Preview with no model calls or writes.                    |
| `--db <path>`                                          | Read this V1 SQLite database.                             |
| `--map <old>=<new>`                                    | Remap a missing session directory. Repeat as needed.      |
| `--since <date>`, `--until <date>`                     | Include work units inside these dates, inclusive.         |
| `--session <id>`                                       | Import one top-level session.                             |
| `--project <dir>`                                      | Include one resolved project directory.                   |
| `--max-sessions <n>`                                   | Limit the number of top-level sessions read.              |
| `--skip-memories`                                      | Record prompts and build the profile only.                |
| `--skip-profile`                                       | Import memories only.                                     |
| `--profile-batch <n>`                                  | Analyse this many prompts per profile batch. Default: 50. |
| `--provider <type>`, `--model <id>`, `--api-url <url>` | Select an external model for this run.                    |
| `--api-key-env <name>`                                 | Read this run's API key from an environment variable.     |
| `--force`                                              | Reprocess memory work units with final ledger states.     |
| `--help`                                               | Show command help.                                        |

Dates use ISO 8601. The importer does not save model overrides to the configuration. To use a cheaper external model for a large backfill:

```bash
export OMMS_IMPORT_KEY='your-key'
npx om-memory-system import-opencode-history \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

Choose a provider type and endpoint supported by your OMMS configuration. Keep keys out of command arguments and shell history. Preview with `--dry-run` first.

## Project resolution

The importer takes each session's recorded directory. If it still exists, that directory determines the project identity. For a deleted worktree, `--map` takes priority over OpenCode's recorded project worktree. A usable project worktree then provides a fallback. Unresolved directories appear in the report and are skipped. The root directory `/` is not a project fallback. Child sessions are folded into their parent session, rather than imported as separate conversations.

## What replaces the old scripts

| Old script             | Built-in step                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| `backfill-memories.py` | Extract and store memories from past exchanges.                    |
| `backfill-profile.py`  | Record your past prompts for profile learning.                     |
| `build-profile.py`     | Analyse those prompts in batches and create or update the profile. |

The import runs all three steps by default. Each exchange can require one model call. Each profile batch can require another. The preview shows pending work units and profile prompts so you can estimate cost. `--skip-memories` and `--skip-profile` reduce the work when you only need one result.

## Rerun, recover and undo

The importer records work unit outcomes in `<storagePath>/import-ledger.db`. Rerunning skips handled memories and deduplicates profile prompts. Failed work remains retryable. If a process stops after a memory write but before a ledger update, the next run checks the stored import identifier and avoids a duplicate. A failed profile batch keeps its prompts for the next run.

There is no automatic undo command. Back up the OMMS data directory before a real import if you might need to roll back. Restore that backup to undo the import, including its memories, prompts, profile changes and ledger. Restoring also discards any newer OMMS data written since the backup. Do not delete ledger entries alone: a rerun can then create duplicate memories.
