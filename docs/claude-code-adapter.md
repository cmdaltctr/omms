# Claude Code Adapter

OMMS includes a Claude Code plugin. It uses the same shared memory engine as
the OpenCode plugin and the Pi extension. All three hosts read and write one
store for each project. So Claude Code can find memories that OpenCode or Pi
captured, and the other hosts can find memories that Claude Code captured.

Claude Code has no in-process plugin API. The plugin is a set of shell hooks
and one skill. Each hook runs the `om-memory-system claude-hook <event>`
command. The command sends the event to the OMMS web app, and the web app does
the memory work. The plugin has no MCP server, and it never changes
`CLAUDE.md`.

The plugin is tested against Claude Code **2.1.284**. The transcript reader
targets that version. See [Transcript format](#transcript-format).

## Before you start

You need:

- Claude Code with plugin support.
- `om-memory-system` installed globally, so that the hooks find it on `PATH`.
- An external API for capture. See [The external API is required](#the-external-api-is-required).

Install the command:

```bash
npm i -g om-memory-system      # or: bun add -g om-memory-system
om-memory-system --version
```

On Windows, the global install adds the `om-memory-system.cmd` shim that the
hooks call. `npx om-memory-system` does not work for the hooks.

If the command is not on `PATH`, each hook fails in the shell. Claude Code then
continues with no added context, and no capture occurs.

## Installation

The plugin files are in the repository root:

| File                              | Content                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `.claude-plugin/plugin.json`      | The plugin manifest. The plugin name is `omms`.             |
| `.claude-plugin/marketplace.json` | A marketplace named `omms` that lists the plugin.           |
| `hooks/hooks.json`                | The `SessionStart`, `UserPromptSubmit`, and `Stop` hooks.   |
| `skills/omms-memory/SKILL.md`     | The skill that tells Claude when to search and save memory. |

The plugin files are not in the npm package. Install the plugin from the
repository.

1. Open Claude Code.
2. Add the OMMS marketplace:

   ```text
   /plugin marketplace add cmdaltctr/omms
   ```

   For a local checkout, give the folder path instead:

   ```text
   /plugin marketplace add /absolute/path/to/omms
   ```

3. Install the plugin:

   ```text
   /plugin install omms@omms
   ```

4. Run `/reload-plugins`, or start a new Claude Code session.

The same steps work from a terminal:

```bash
claude plugin marketplace add cmdaltctr/omms
claude plugin install omms@omms
```

### Hooks by hand

You can add the hooks without the plugin. Put this block in
`~/.claude/settings.json`. It is the same as `hooks/hooks.json`. If the file
already has a `hooks` object, merge the three events into it.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "om-memory-system claude-hook session-start",
            "timeout": 20
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "om-memory-system claude-hook user-prompt-submit",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "om-memory-system claude-hook stop",
            "timeout": 60,
            "async": true
          }
        ]
      }
    ]
  }
}
```

A hand edit does not install the skill. To give Claude the same guidance,
copy `skills/omms-memory/` to `~/.claude/skills/omms-memory/`.

## Configuration

The hooks and the web app read the same configuration files as the other
hosts. See [Configuration](configuration.md).

- The hook command reads the global config only (`~/.config/omms/omms.jsonc`). It uses `webServerEnabled`, `webServerHost`, `webServerPort`, and the Basic Auth settings to find the web app.
- The web app reads the project config for the session's working directory before each request.
- Retrieval uses `chatMessage.enabled`, `chatMessage.maxMemories`, `chatMessage.excludeCurrentSession`, and `chatMessage.maxAgeDays`.
- Retrieval after compaction uses `compaction.enabled` and `compaction.memoryLimit`.
- Capture uses `autoCaptureEnabled` and `autoCaptureMaxRetries`.
- Profile learning uses `userProfileAnalysisInterval`.

When `webServerEnabled` is `false`, the hooks do nothing.

### The external API is required

Claude Code capture and profile learning use the external API only:
`memoryModel`, `memoryApiUrl`, and `memoryApiKey`. Set them on the Settings
page's **External API** card, or in the global config. See
[Configuration: Choosing the model](configuration.md#choosing-the-model).

- There is no Claude Code host model setting. There is no `claudeProvider` or `claudeModel` key.
- There is no session model path. A hook cannot call the model of the Claude Code session.
- When the external API is not fully configured, Claude Code capture and profile learning are off. The web app writes `Claude Code capture is off` to the log once per process, with the missing settings.
- Retrieval and the `memory` command work without the external API.

Use a `file://` key reference. The web app can run from the login item or
from OpenCode, and those processes may not have your shell's environment
variables. An `env://` key then does not resolve.

## How it works

### The web app does the work

A hook is a short process. It cannot keep the store and the embedding model
open. The OMMS web app does this work. See [Web UI](web-ui.md).

Each hook:

1. Reads the hook input from standard input. It stops reading after 2 seconds.
2. Checks `GET /api/health` on the configured web app address.
3. Starts the web app when no OMMS web app answers. See [Start on demand](#start-on-demand).
4. Sends one request to the web app with the `x-omms-token` header.
5. Prints the added context for Claude Code, if there is any.
6. Writes one metadata line to `~/.omms/omms.log`.
7. Exits with code 0.

The hook exits with code 0 on every failure. A broken or missing OMMS never
blocks Claude Code.

| Event              | `hooks.json` timeout | Start budget | Request budget | Mode  |
| ------------------ | -------------------- | ------------ | -------------- | ----- |
| `SessionStart`     | 20 s                 | 15 s         | 3 s            | sync  |
| `UserPromptSubmit` | 10 s                 | 5 s          | 3 s            | sync  |
| `Stop`             | 60 s                 | 30 s         | 5 s            | async |

The hook reads the API token from `~/.omms/.auth-token`, the same file the web
app creates. When `webServerAuthPassword` is set, the hook also sends Basic
Auth.

### Start on demand

When no OMMS web app answers, the hook starts `om-memory-system web` as a
detached process. It uses the same runtime rule as the login item, and the web
app uses the same port, bind address, and token rules. The hook then checks
the health route until the web app answers or the start budget ends.

- The web app keeps running after the Claude Code session ends.
- When OpenCode, the login item, or `om-memory-system web` already serves the web app, the hook uses it and starts nothing.
- When two hooks start the web app at the same time, the port ownership rules keep one server.
- The first `SessionStart` of the day can take some seconds. A prompt sent before the web app is ready gets no added context.

To avoid the start delay, install the login item with
`om-memory-system web install`. See [CLI: Web app commands](cli.md#web-app-commands).

### Web app routes

The web app has two routes for the hooks. Both need the API token, like the
other `/api/` routes. A request without the token gets `401 Unauthorized`.

| Route                       | Used by                            | Answer                                       |
| --------------------------- | ---------------------------------- | -------------------------------------------- |
| `POST /api/claude/retrieve` | `SessionStart`, `UserPromptSubmit` | `{ "additionalContext": "<text or empty>" }` |
| `POST /api/claude/capture`  | `Stop`                             | `202 { "queued": true }` at once             |

The routes are in `src/services/web-server.ts`. The handlers are in
`src/importer/claude-hook-api.ts`, because they use the transcript reader. The
web server loads them with a dynamic `import()`.

### Retrieval

| Hook                                         | Added context                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SessionStart`, source `startup` or `clear`  | The project's recent memories. This is the same list and count that OpenCode adds to the first message.           |
| `SessionStart`, source `compact` or `resume` | The memories captured from this session, in the compaction format that the other hosts use.                       |
| `UserPromptSubmit`                           | The shared retrieval section for the prompt. Nothing when no memory matches, or when the prompt is fully private. |

- Every added text is inside `<omms-retrieval>` tags.
- The hook cuts the text to 9,500 characters and keeps the closing tag. Claude Code accepts at most 10,000 characters.
- Capture removes the `<omms-retrieval>` section from each prompt, so injected memories are never captured again.

### Capture

On `Stop`, the hook sends the session ID, the transcript path, the working
directory, and Claude's final reply to the capture route. The web app puts the
turn on a queue with one worker and answers at once.

The worker:

1. Checks that `autoCaptureEnabled` is on and that the external API is fully configured.
2. Reads the transcript file with the shared reader. See [Claude Code history import: How windows are built](claude-code-history-import.md#how-windows-are-built).
3. Takes each turn after the last turn it captured for this session. With no saved position, it takes the last turn only.
4. Adds Claude's final reply from the hook when the transcript file does not hold it yet.
5. Removes `<private>` text and the retrieval section. It skips a fully private prompt.
6. Runs each turn through the shared capture pipeline with the external API.
7. Saves the new position for the session.

- A failed turn tries again up to `autoCaptureMaxRetries` times, 2 and 4 seconds apart, the same as Pi.
- When the model cannot be reached, the turn goes to the [capture retry queue](configuration.md#capture-retry-queue). The other turns of the same request go to the queue without a model call.
- The web app starts the Claude Code retry pass when it takes its port. **Retry now** on the Settings page also works for Claude Code.
- When `Stop` fires twice for the same turn, the second request captures nothing.
- A missing or unreadable transcript is skipped with one log line. The hook still exits with code 0.

The saved position is in the `claude_capture_cursors` table in
`~/.omms/data/user-prompts.db`. It holds the session ID and the last captured
user entry ID, never text. A web app restart does not capture the last turn
again. A session with no capture for 30 days loses its position.

### Profile learning

The web app records each captured Claude Code prompt. When the number of new
prompts reaches `userProfileAnalysisInterval`, it runs one profile learning
pass with the external API. A failed pass is logged. It never blocks capture
or the `memory` command.

Claude Code profile learning calls the external API directly. It does not
register a host profile model, because that registration is for the whole
process. When the web app runs inside OpenCode, it would replace OpenCode's
model.

### Backfill

The first `SessionStart` that reaches the web app after the web app starts
also starts the Claude Code backfill, under the `autoBackfill` rules. The web
app tries this once per process. See
[Claude Code history import: Automatic import](claude-code-history-import.md#automatic-import).

## The `memory` command

Claude Code has no in-process `memory` tool. The plugin skill tells Claude to
run the `om-memory-system memory` command in its Bash tool instead. You can run
it too.

```text
om-memory-system memory <mode> [options]
```

The command runs one memory operation for the project in the working
directory. It prints one JSON document with the same fields that the `memory`
tool returns. Memories added with it have host `claude-code`.

| Mode          | What it does                                              | Options                                                              |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `add`         | Store a memory                                            | `--content`, `--type`, `--tags`                                      |
| `search`      | Search project memories                                   | `"<query>"` or `--query`, `--limit`, `--scope`                       |
| `list`        | List recent memories (default 20)                         | `--limit`, `--scope`                                                 |
| `forget`      | Remove a memory                                           | `--id`                                                               |
| `profile`     | Show the user profile, or save a preference               | `--content`                                                          |
| `help`        | Print the memory tool guide as JSON                       | none                                                                 |
| `list-shards` | List project memory shards and orphaned path associations | none                                                                 |
| `migrate`     | Link orphaned shards again after a folder move            | `--from-path` or `--from-hash`, `--dry-run`, `--allow-linked-source` |
| `export`      | Export project memories to a portable JSON file           | `--output`                                                           |
| `import`      | Import memories from a portable JSON file                 | `--input`, `--dry-run`                                               |

| Option                  | Effect                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `--content <text>`      | Memory text (`add`) or preference text (`profile`)          |
| `--query <text>`        | Search text (`search`)                                      |
| `--type <type>`         | Memory type, for example `decision` or `bug-fix` (`add`)    |
| `--tags <a,b>`          | Comma-separated tags (`add`)                                |
| `--id <id>`             | Memory ID (`forget`)                                        |
| `--limit <n>`           | Maximum results (`search`, `list`). A positive whole number |
| `--scope <scope>`       | `project` or `all-projects` (`search`, `list`)              |
| `--from-path <path>`    | Old project path (`migrate`)                                |
| `--from-hash <hash>`    | Old project hash (`migrate`)                                |
| `--output <file>`       | Export file (`export`)                                      |
| `--input <file>`        | Import file (`import`)                                      |
| `--dry-run`             | Report without writing (`migrate`, `import`)                |
| `--allow-linked-source` | Allow a linked source folder (`migrate`)                    |
| `--directory <path>`    | Project folder. The default is the working directory        |
| `--help`, `-h`          | Print the help                                              |

Examples:

```bash
om-memory-system memory search "database choice"
om-memory-system memory add --content "Use libSQL for the store" --type decision
om-memory-system memory list --limit 5
om-memory-system memory forget --id <memory id>
```

- A value can follow its flag or use `--flag=value`.
- OMMS removes text inside `<private>` tags before storage. Fully private content is not stored.
- API keys in the output are replaced with `[redacted]`.
- The exit code is 0 on success. It is 1 for a bad option or a result with `"success": false`. A bad option prints the error and the help on standard error.

The command opens the store directly. It does not need the web app.

## Provenance

Memories captured from Claude Code carry:

```json
{
  "host": "claude-code",
  "hostSessionId": "<Claude Code session id>",
  "sourceType": "live-capture",
  "promptId": "<user entry uuid>",
  "sourceEntryIds": ["<user entry uuid>", "<assistant entry uuids>"],
  "sourceTimestamp": 1767225600000
}
```

Provenance is only metadata. It never changes which memories a host can
retrieve.

## Transcript format

Live capture and the history import read Claude Code's session transcripts in
`~/.claude/projects/<project-folder>/<session-id>.jsonl`. Claude Code says this
format is internal and can change between versions.

- The reader is written against Claude Code 2.1.284. Fixture transcripts in `tests/fixtures/claude-transcripts/` pin that format.
- The reader skips lines that are not JSON, and entries of an unknown type. It counts both.
- The hook sends Claude's final reply. So capture keeps the final text even when the transcript lags.

After a Claude Code upgrade, check that new turns appear in the web app. If
they do not, look for `Claude Code capture skipped` lines in the log.

## Troubleshooting

The hook writes one `Claude Code hook` line to `~/.omms/omms.log` for each
run. The line holds the event, a code, the elapsed time, whether the hook
started the web app, and the input and output sizes. It never holds prompt or
reply text.

| Code                 | Meaning                                                                  | What to do                                                             |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `ok`                 | The request succeeded.                                                   | Nothing.                                                               |
| `no-input`           | The hook got no input in 2 seconds.                                      | Check the hook command in `hooks.json` or `settings.json`.             |
| `bad-input`          | The input was not the expected JSON.                                     | Check that the event name in the command matches the hook.             |
| `bad-event`          | The event name after `claude-hook` is unknown.                           | Use `session-start`, `user-prompt-submit`, or `stop`.                  |
| `server-disabled`    | `webServerEnabled` is `false` in the global config.                      | Set `webServerEnabled` to `true`.                                      |
| `server-unreachable` | No web app answered, and OMMS found no Node or Bun runtime to start one. | Install Node or Bun, or run `om-memory-system web install`.            |
| `start-timeout`      | The hook started the web app, but it did not answer within the budget.   | Run `om-memory-system web` in a terminal and read its error.           |
| `timeout`            | The web app did not answer the request in time.                          | Check that the web app is not busy with a large import.                |
| `network-error`      | The request failed before an answer.                                     | Run `om-memory-system web status`.                                     |
| `http-401`           | The web app rejected the token.                                          | Check that the hook and the web app run as the same user.              |
| `http-<status>`      | The web app returned another error.                                      | Read the web app's log lines around the same time.                     |
| `bad-response`       | The retrieval answer had no `additionalContext` text.                    | Update OMMS so that the command and the web app have the same version. |

Other checks:

- **No memories are captured.** Look for `Claude Code capture is off` in the log. It names the missing external API settings. The Settings page shows the same status. `GET /api/settings` returns it as `effective["claude-code"]`, with `ready` and `issues`.
- **Captures fail.** Read the `Capture attempt` lines. See [Configuration: Capture diagnostics](configuration.md#capture-diagnostics).
- **The command is not found.** Run `om-memory-system --version` in the shell that starts Claude Code. Install it globally if it fails.
- **The backfill did not start.** The web app tries the Claude Code backfill once per process. If the external API was missing at that time, set it up and select **Run now**, or restart the web app.

### Known limit: web app on another port

When another program holds the configured port, the web app moves to the next
free port, up to 10 ports higher. The hook knows only the configured port, so
it cannot find the web app. The hook then tries to start a second web app,
which also fails.

To fix this:

1. Find the program that uses the port.
2. Stop that program, or set `webServerPort` to a free port in the global config.
3. Start a new Claude Code session.

## Uninstall and rollback

To remove the plugin:

1. Run `/plugin uninstall omms@omms` in Claude Code.
2. Optional: run `/plugin marketplace remove omms` to remove the marketplace.

If you added the hooks by hand, remove the three hook entries from
`~/.claude/settings.json`.

- Memories captured with host `claude-code` stay in the store. OpenCode and Pi can still retrieve them.
- The web app that a hook started keeps running until you stop it or sign out. The login item is not changed.
- To stop the Claude Code backfill, pause it on the Settings page, or set `"autoBackfill": false`.

## Limitations

- Capture and profile learning need the external API. There is no session model path.
- Claude Code has no in-session import command. Use `om-memory-system import-claude-history` or the Settings page. See [claude-code-history-import.md](claude-code-history-import.md).
- One user prompt is one work unit. OMMS does not capture single tool calls.
- Subagent (sidechain) turns are not captured.
- The transcript format is internal to Claude Code. A new Claude Code version can change it.
