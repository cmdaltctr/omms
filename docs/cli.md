# omms CLI

The npm package ships one terminal command, `om-memory-system`. Use it to import past OpenCode, Pi, and Claude Code history, run the web app, and manage the web app's login item. It also runs the Claude Code hooks and manual memory operations. You do not need an agent session open.

## Command reference

| Command                                            | What it does                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `om-memory-system import-opencode-history [flags]` | Import OpenCode history with the external API.                                                                      |
| `om-memory-system import-pi-history [flags]`       | Import Pi history with the external API.                                                                            |
| `om-memory-system import-claude-history [flags]`   | Import Claude Code history with the external API.                                                                   |
| `om-memory-system web`                             | Start the web app in the foreground.                                                                                |
| `om-memory-system web install`                     | Set `webServerAutoStart` to `true` and install the login item.                                                      |
| `om-memory-system web uninstall`                   | Set `webServerAutoStart` to `false` and remove the login item.                                                      |
| `om-memory-system web status`                      | Print the setting, the login item state, the URL, and whether the web app is up.                                    |
| `om-memory-system --version`, `-v`                 | Print the installed version and exit with code `0`.                                                                 |
| `om-memory-system --help`, `-h`, or no arguments   | Print the command list.                                                                                             |
| `om-memory-system <import command> --help`         | Print the flags for that import command.                                                                            |
| `om-memory-system memory <mode> [options]`         | Run one memory operation and print JSON. See [The memory command](#the-memory-command).                             |
| `om-memory-system claude-hook <event>`             | Run a Claude Code hook. The Claude Code plugin calls it. See [Claude Code hook command](#claude-code-hook-command). |

Slash commands inside a session:

| Host     | Command                                   | What it does                                      |
| -------- | ----------------------------------------- | ------------------------------------------------- |
| OpenCode | `/memory-import-opencode-history [flags]` | Import OpenCode history with the session's model. |
| Pi       | `/memory-import-pi-history [flags]`       | Import Pi history with the session's model.       |

- Both slash commands take the [import flags](#import-options), except `--provider`, `--api-url`, and `--api-key-env`.
- `--help` on a slash command shows its flags.
- Claude Code has no slash command. Use `import-claude-history` or the Settings page.
- You can also run imports, backfills, and directory maps from the web Settings page. See [Web UI settings](web-ui-settings.md).

## Global install (optional, recommended)

`npx om-memory-system` works without an install. A global install has two benefits:

- The login item and the terminal commands run without `npx`.
- One known version stays on your `PATH`.

```bash
npm i -g om-memory-system      # or: bun add -g om-memory-system
om-memory-system --version
```

Upgrade with `npm i -g om-memory-system@latest` or `bun add -g om-memory-system@latest`. The Settings page shows the running version next to the global command's version. It warns when they differ.

## Which model an import uses

The terminal import commands and the slash commands run the same importer with the same options. Only the model differs.

| Where you run it | Model used                                                                                                      | API key needed |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| Slash command    | This session's model, or `--model provider/id` from the host's signed-in models                                 | No             |
| Terminal         | The saved external API (`memoryProvider`, `memoryModel`, `memoryApiUrl`, `memoryApiKey`), or flags for this run | Yes            |
| Settings page    | See [Web UI settings](web-ui-settings.md)                                                                       | Depends        |

- Use the slash command when you can. It uses the model you are already signed in to.
- Use the terminal for scripts, or when no session is open.
- An import never saves its model choice to the configuration.

## Requirements

- Node.js 22.14 or later. The OpenCode reader uses `node:sqlite`.
- `import-pi-history` loads sessions through `@earendil-works/pi-coding-agent`. This is a peer dependency that npm installs with the package.
- `import-claude-history` reads Claude Code transcripts directly. It needs no Claude Code package.
- The same omms configuration and store as the plugins. The CLI reads the global config and the project config of the directory you run it from.

## Quick start

1. Go to your project folder.
2. Preview first. A dry run makes no model calls and writes no store files.

   ```bash
   cd ~/code/my-project
   npx om-memory-system import-opencode-history --dry-run
   npx om-memory-system import-pi-history --dry-run
   ```

3. Import with the saved external model.

   ```bash
   npx om-memory-system import-opencode-history
   ```

To use a different external model for one run, pass its settings. Keep the key in an environment variable, never on the command line:

```bash
export OMMS_IMPORT_KEY='your-key'
npx om-memory-system import-pi-history --scope all-projects \
  --provider openai-chat --model 'your-smaller-model-id' \
  --api-url 'https://your-provider.example/v1' --api-key-env OMMS_IMPORT_KEY
```

Before a real import starts, the CLI prints `Import model: provider/model`.

## Import options

| Flag                               | Effect                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--dry-run`                        | Preview counts. No model calls and no writes.                                                                                                                                                                                  |
| `--provider <type>`                | Terminal only. External provider type: `openai-chat`, `openai-responses`, `anthropic`, `minimax`, `google-gemini`, or `orcarouter`. Default: saved `memoryProvider`.                                                           |
| `--model <id>`                     | Terminal: external model id. Default: saved `memoryModel`. Slash command: `provider/id` of a signed-in model. Default: the session's model.                                                                                    |
| `--api-url <url>`                  | Terminal only. Endpoint. Required when `--provider` differs from the saved provider, except for `orcarouter`.                                                                                                                  |
| `--api-key-env <name>`             | Terminal only. Read the API key from this environment variable. Default: saved `memoryApiKey`.                                                                                                                                 |
| `--scope <scope>`                  | `current-project` (default) or `all-projects`.                                                                                                                                                                                 |
| `--project <dir>`                  | Project for `current-project` scope. Default: the working directory. Cannot be used with `--scope all-projects`.                                                                                                               |
| `--session <id>`                   | Import one session. Pi and Claude Code also accept the session file path.                                                                                                                                                      |
| `--since <date>`, `--until <date>` | Inclusive date range. A bare date in `--until` covers that whole day. `--since` must be before `--until`.                                                                                                                      |
| `--max-sessions <n>`               | Read at most this many sessions, oldest first. Must be a positive whole number.                                                                                                                                                |
| `--map <old>=<new>`                | Map a recorded directory to another one for this run. Adds to the saved `importPathMaps` and wins for the same `<old>`. Repeat as needed.                                                                                      |
| `--db <path>`                      | OpenCode only. The database. Default: `~/.local/share/opencode/opencode.db`.                                                                                                                                                   |
| `--root <path>`                    | Pi and Claude Code only. Pi: a session folder or one `.jsonl` session file. Default: `~/.pi/agent/sessions`. Claude Code: a transcripts folder, one project folder, or one `.jsonl` transcript. Default: `~/.claude/projects`. |
| `--skip-memories`                  | Record profile prompts only.                                                                                                                                                                                                   |
| `--skip-profile`                   | Import memories only.                                                                                                                                                                                                          |
| `--profile-batch <n>`              | Prompts per profile analysis batch. Default: 50. Must be a positive whole number.                                                                                                                                              |
| `--force`                          | Reprocess memory work units that already finished.                                                                                                                                                                             |
| `--help`, `-h`                     | Show help for the command.                                                                                                                                                                                                     |

- A value may follow its flag or use `--flag=value`.
- Dates accept ISO 8601 or epoch milliseconds.
- Inside a session, `--provider`, `--api-url`, and `--api-key-env` are rejected.
- An unknown flag, `--db` on Pi or Claude Code, or `--root` on OpenCode, is an error.
- `import-claude-history` always uses the external API or the `--provider`, `--api-url`, and `--api-key-env` flags. Claude Code has no session model.

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

| Exit code | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `0`       | Finished, help shown, or version shown. `claude-hook` always exits with `0`.                              |
| `1`       | Bad options, missing model settings, a failed work unit, a failed profile batch, or a failed web command. |

Error messages never contain the API key. The key from `--api-key-env` and the saved `memoryApiKey` are replaced with `[redacted]`.

## Web app commands

`om-memory-system web` runs the web app in the foreground, without Pi or OpenCode.

- It needs `webServerEnabled: true`, and the configured port must be free.
- Press Ctrl+C to stop it.
- If an OpenCode host already owns the port, OMMS leaves that owner running.

`om-memory-system web install` sets `webServerAutoStart` to `true` in the global config and registers the login item.

- It needs `webServerEnabled: true`, an installed Node or Bun runtime, and a package path it can find.
- It prints the web app URL from `webServerHost` and `webServerPort`, for example `http://127.0.0.1:4747`.
- For a Homebrew runtime, the item stores the stable link, for example `/opt/homebrew/bin/node`. It does not store the versioned `Cellar` path, so a Homebrew upgrade does not break the item.
- It exits with code `1` if the item is not installed.

`om-memory-system web uninstall` sets `webServerAutoStart` to `false` and removes only OMMS's own item.

`om-memory-system web status` prints JSON with the setting, the item state, the web app URL, and whether a web app answers. It changes nothing.

Any other argument after `web` prints the usage and exits with code `1`.

Supported platforms are macOS, Linux with systemd user services, and Windows. On other platforms, or without a runtime, run `om-memory-system web` yourself.

The login item starts the standalone web app after sign-in. It uses the same data and settings as the hosts. See [Web UI](web-ui.md) for port ownership and authentication.

## The memory command

`om-memory-system memory <mode> [options]` runs one shared memory operation
from a terminal. The Claude Code skill uses it, because Claude Code has no
in-process `memory` tool. OpenCode and Pi keep their `memory` tool.

```bash
om-memory-system memory search "database choice"
om-memory-system memory add --content "Use libSQL for the store" --type decision
```

- Modes: `add`, `search`, `list`, `forget`, `profile`, `help`, `list-shards`, `migrate`, `export`, and `import`.
- The command works on the project in the working directory. `--directory <path>` chooses another project.
- It prints one JSON document with the same fields as the `memory` tool.
- Memories added with it have host `claude-code`.
- It opens the store directly. It does not need the web app.
- It exits with code 1 for a bad option or a result with `"success": false`.
- `om-memory-system memory --help` prints every mode and flag.

The full table of modes and flags is in
[Claude Code adapter: The memory command](claude-code-adapter.md#the-memory-command).

## Claude Code hook command

`om-memory-system claude-hook <event>` runs one Claude Code hook. The Claude
Code plugin calls it. You do not run it by hand.

- `<event>` is `session-start`, `user-prompt-submit`, or `stop`.
- It reads the hook input from standard input, for at most 2 seconds.
- It sends the event to the OMMS web app. When no web app answers, it starts `om-memory-system web` in the background.
- It always exits with code 0, so a failure never blocks Claude Code.
- It writes one metadata line to `~/.omms/omms.log`. The line never holds prompt or reply text.

To test that the command runs:

```bash
echo '{}' | om-memory-system claude-hook stop
```

See [Claude Code adapter](claude-code-adapter.md) for the hooks, time limits,
and log codes.

## Safety

- The CLI only reads history. OpenCode's database, its `-wal` and `-shm` files, Pi's session files, and Claude Code's transcripts stay unchanged. See [opencode-history-import.md](opencode-history-import.md) for how the WAL is read while OpenCode is open.
- Reruns are safe. A ledger in the store skips finished work. Failed work stays retryable.
- One import per host runs at a time. A real import (not `--dry-run`) takes the host's lock in the store. A CLI run, a slash command, a web import, and a backfill for the same host cannot overlap. The second one stops with "A Pi import is already running", or the OpenCode version of that message.
- Every real import records its progress in the store. The Settings page shows a CLI run with its percentage and time left. If the terminal closes, the page shows the run as stopped. Run the command again to continue from the ledger.
- There is no undo command. Back up `~/.omms/data` before a large import if you may want to roll back.

## See also

- [OpenCode history import](opencode-history-import.md)
- [Pi history import](pi-history-import.md)
- [Claude Code adapter](claude-code-adapter.md)
- [Claude Code history import](claude-code-history-import.md)
- [Web UI settings](web-ui-settings.md)
- [Configuration: Choosing the model](configuration.md#choosing-the-model), for how live capture chooses its model
