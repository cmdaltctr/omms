# omms CLI

The npm package ships one command, `om-memory-system`. It imports past OpenCode
and Pi history into the omms memory store from a terminal, without an agent
session open.

```text
om-memory-system import-opencode-history [options]
om-memory-system import-pi-history [options]
```

Both commands take the same options and run the same importer as the in-session
slash commands `/memory-import-opencode-history` and `/memory-import-pi-history`.
The difference is the model:

| Where you run it | Model used                                                                                                      | API key needed |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| Slash command    | This session's model, or `--model provider/id` from the host's signed-in models                                 | No             |
| CLI              | The saved external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`), or flags for this run | Yes            |

Use the slash command when you can: it uses the model you are already signed
in to. Use the CLI for scripts, or when no session is open.

## Requirements

- Node.js 22.14 or later (the OpenCode reader uses `node:sqlite`).
- `import-pi-history` loads sessions through `@earendil-works/pi-coding-agent`,
  a peer dependency that npm installs with the package.
- The same omms configuration and store as the plugins. The CLI reads the
  global config and the project config of the directory you run it from.

## Quick start

Preview first. A dry run makes no model calls and writes no store files:

```bash
cd ~/code/my-project
npx om-memory-system import-opencode-history --dry-run
npx om-memory-system import-pi-history --dry-run
```

Import with the saved external model:

```bash
npx om-memory-system import-opencode-history
```

Or pick a different external model for this run only. Keep the key in an
environment variable, never in the command line:

```bash
export OMMS_IMPORT_KEY='your-key'
npx om-memory-system import-pi-history --scope all-projects \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

Before a real import starts, the CLI prints `Import model: provider/model`.
Nothing is saved to the configuration.

## Options

| Flag                               | Effect                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                        | Preview counts with no model calls or writes.                                                                                       |
| `--provider <type>`                | External provider type: `openai-chat`, `openai-responses`, `anthropic`, `minimax` or `orcarouter`. Default: saved `memoryProvider`. |
| `--model <id>`                     | External model id. Default: saved `memoryModel`.                                                                                    |
| `--api-url <url>`                  | Endpoint. Required when `--provider` differs from the saved provider (except `orcarouter`).                                         |
| `--api-key-env <name>`             | Read the API key from this environment variable. Default: saved `memoryApiKey`.                                                     |
| `--scope <scope>`                  | `current-project` (default) or `all-projects`.                                                                                      |
| `--project <dir>`                  | Project for `current-project` scope. Default: the working directory.                                                                |
| `--session <id>`                   | Import one session (Pi also accepts a session file path).                                                                           |
| `--since <date>`, `--until <date>` | Inclusive date range. A bare date in `--until` covers that whole day.                                                               |
| `--max-sessions <n>`               | Read at most this many sessions, oldest first.                                                                                      |
| `--map <old>=<new>`                | Map a recorded directory that no longer exists. Repeat as needed.                                                                   |
| `--db <path>`                      | OpenCode only: database. Default `~/.local/share/opencode/opencode.db`.                                                             |
| `--root <dir>`                     | Pi only: session root. Default `~/.pi/agent/sessions`.                                                                              |
| `--skip-memories`                  | Record profile prompts only.                                                                                                        |
| `--skip-profile`                   | Import memories only.                                                                                                               |
| `--profile-batch <n>`              | Prompts per profile analysis batch. Default: 50.                                                                                    |
| `--force`                          | Reprocess memory work units that already finished.                                                                                  |
| `--help`                           | Show help for the command.                                                                                                          |

A value may follow its flag or use `--flag=value`. Dates accept ISO 8601 or
epoch milliseconds. `--provider`, `--api-url` and `--api-key-env` exist only
on the CLI; inside a session they are rejected, and `--model` takes
`provider/id` instead of a bare id.

## Output and exit codes

The CLI prints the same report as the slash commands:

```text
OpenCode history import (dry-run)
  sessions: 426/452 loaded, 0 filtered out, 545 child sessions folded
  memory units: 2422 pending, 0 already done, 0 imported, 0 skipped, 0 failed
  project /Users/me/code/my-project: 12 sessions, 80 units
  unresolved /Users/me/old-worktree: 3 sessions, 9 units (use --map)
  profile prompts: 2422 pending, 0 recorded, 0 already done; 0 batches, 0 remaining
```

| Exit code | Meaning                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `0`       | Finished, or help shown.                                                            |
| `1`       | Bad options, missing model settings, a failed work unit, or a failed profile batch. |

Error messages never contain the API key: the key from `--api-key-env` and the
saved `memoryApiKey` are replaced with `[redacted]`.

## Safety

- The CLI only reads history. OpenCode's database and its `-wal`/`-shm` files
  and Pi's session files stay unchanged. See
  [opencode-history-import.md](opencode-history-import.md) for how the WAL is
  read while OpenCode is open.
- Reruns are safe. A ledger in the store skips work that already finished, and
  failed work stays retryable. Run one importer at a time against a store.
- There is no undo command. Back up `~/.omms/data` before a large import if
  you may want to roll back.

## See also

- [OpenCode history import](opencode-history-import.md)
- [Pi history import](pi-history-import.md)
- [Configuration: Choosing the model](configuration.md#choosing-the-model), for how live capture chooses its model
