# omms CLI

The npm package ships one terminal command, `om-memory-system`. Use it to import past OpenCode, Pi, and Claude Code history, run the web app, and manage the web app's login item. It also runs the Claude Code hooks and manual memory operations. You do not need an agent session open.

## Command reference

| Command                                                 | What it does                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `om-memory-system import-opencode-history [flags]`      | Import OpenCode history with the external API.                                                                      |
| `om-memory-system import-pi-history [flags]`            | Import Pi history with the external API.                                                                            |
| `om-memory-system import-claude-history [flags]`        | Import Claude Code history with the external API.                                                                   |
| `om-memory-system web`                                  | Start the web app in the foreground.                                                                                |
| `om-memory-system web install`                          | Set `webServerAutoStart` to `true` and install the login item.                                                      |
| `om-memory-system web uninstall`                        | Set `webServerAutoStart` to `false` and remove the login item.                                                      |
| `om-memory-system web status`                           | Print the setting, the login item state, the URL, and whether the web app is up.                                    |
| `om-memory-system web update`                           | Update the global install to npm `latest`, then replace the web app with a fresh one.                               |
| `om-memory-system --version`, `-v`                      | Print the installed version and exit with code `0`.                                                                 |
| `om-memory-system --help`, `-h`, or no arguments        | Print the command list.                                                                                             |
| `om-memory-system <import command> --help`              | Print the flags for that import command.                                                                            |
| `om-memory-system memory <mode> [options]`              | Run one memory operation and print JSON. See [The memory command](#the-memory-command).                             |
| `om-memory-system claude-hook <event>`                  | Run a Claude Code hook. The Claude Code plugin calls it. See [Claude Code hook command](#claude-code-hook-command). |
| `om-memory-system profile-catch-up [flags]`             | Analyse every prompt that waits for profile learning. See [Profile catch-up](#profile-catch-up).                    |
| `om-memory-system profile-normalise-categories [flags]` | Preview or confirm category renames. See [Normalise profile categories](#normalise-profile-categories).             |
| `om-memory-system skills <mode> [flags]`                | List skills, review proposals, record or delete turns. See [Skill turns](#skill-turns).                             |

Slash commands inside a session:

| Host     | Command                                   | What it does                                      |
| -------- | ----------------------------------------- | ------------------------------------------------- |
| OpenCode | `/memory-import-opencode-history [flags]` | Import OpenCode history with the session's model. |
| Pi       | `/memory-import-pi-history [flags]`       | Import Pi history with the session's model.       |

- Both slash commands take the [import flags](#import-options), except `--provider`, `--api-url`, and `--api-key-env`.
- `--help` on a slash command shows its flags.
- Claude Code has no slash command. Use `import-claude-history` or the Settings page.
- You can also run imports, backfills, and directory maps from the web Settings page. See [Web UI settings](web-ui-settings.md).

## Global install (optional)

`npx om-memory-system` works without an install. A global install is optional. It gives you the command on your `PATH` without `npx`.

```bash
npm i -g om-memory-system      # or: bun add -g om-memory-system
om-memory-system --version
```

You do not need to keep the global install up to date. See [Hand-off to the newest copy](#hand-off-to-the-newest-copy). To update it, run `npm i -g om-memory-system@latest` or `bun add -g om-memory-system@latest`. The Settings page shows the running version next to the version of the global install.

## Hand-off to the newest copy

OMMS keeps a record of the newest copy on the machine in `~/.omms/runtime.json`. Each OpenCode start, each Pi start, and each run of `om-memory-system` write their own copy to the record when it is newer.

When the record names a valid copy that is newer than the running command, the command runs that copy. The copy gets the same arguments, input, and exit code. `om-memory-system --version` prints the version of the copy that runs.

- A global install from 4.3 or earlier has no hand-off code. Update it once.
- Set `OMMS_NO_HANDOFF=1` to run the code of the command you typed, for one command.
- A copy that is not valid is ignored. A copy is valid when its `package.json` names `om-memory-system`, its version can be compared, and it has `dist/cli/index.js`.
- A failure to read or write the record never stops the command.

See [Updating and upgrading](upgrading.md#one-update-updates-every-host).

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
- `import-pi-history` loads sessions through `@earendil-works/pi-coding-agent`. This is a peer dependency that npm installs with the package. When OMMS cannot load it from its own folder, for example in the login web app, it uses the copy in Pi's install: first `~/.pi/agent/install/releases/<current version>`, then the package behind each `pi` command on `PATH`, then the global `node_modules` of the running Node.
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
| `--skip-memories`                  | Save no memories.                                                                                                                                                                                                              |
| `--skip-profile`                   | Record no profile prompts.                                                                                                                                                                                                     |
| `--skip-skills`                    | Record no skill turns. An import records skill turns only while `skillLearning` is on. See [Skill turns](#skill-turns).                                                                                                        |
| `--profile-batch <n>`              | Prompts per profile analysis batch. Default: 50. Must be a positive whole number.                                                                                                                                              |
| `--force`                          | Reprocess memory work units and profile prompts that already finished. Use `--force --skip-memories` to rebuild the profile only.                                                                                              |
| `--help`, `-h`                     | Show help for the command.                                                                                                                                                                                                     |

- A value may follow its flag or use `--flag=value`.
- Dates accept ISO 8601 or epoch milliseconds.
- Inside a session, `--provider`, `--api-url`, and `--api-key-env` are rejected.
- An unknown flag, `--db` on Pi or Claude Code, or `--root` on OpenCode, is an error.
- `import-claude-history` always uses the external API or the `--provider`, `--api-url`, and `--api-key-env` flags. Claude Code has no session model.
- `--skip-memories --skip-profile` with `skillLearning` on records skill turns only. This run makes no model call and needs no model settings. It also records sessions whose project folder no longer exists, under the recorded folder path.

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

While `skillLearning` is on, the report also has a `skill turns` line. A dry run shows `skill turns: 2422 pending, 0 already recorded`. A real run shows `skill turns: 2422 recorded, 0 already present`.

| Exit code | Meaning                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `0`       | Finished, help shown, or version shown. `claude-hook` always exits with `0`.                              |
| `1`       | Bad options, missing model settings, a failed work unit, a failed profile batch, or a failed web command. |

Error messages never contain the API key. The key from `--api-key-env` and the saved `memoryApiKey` are replaced with `[redacted]`.

## Web app commands

`om-memory-system web` runs the web app in the foreground, without Pi or OpenCode.

- It needs `webServerEnabled: true`, and the configured port must be free.
- Press Ctrl+C to stop it.
- If another OMMS web app already owns the port, OMMS leaves that owner running.
- Stop and Restart in the page's [power button](web-ui.md#power-button) also work on it. A Restart of a web app you started by hand starts a detached copy, so the terminal no longer shows its output.
- To start the web app again after a Stop, run this command, start OpenCode or Pi, send a prompt in Claude Code, or run `om-memory-system web install`.

`om-memory-system web install` sets `webServerAutoStart` to `true` in the global config and registers the login item.

- It needs `webServerEnabled: true`, an installed Node or Bun runtime, and an OMMS copy that has a launcher.
- The item runs the launcher at `~/.omms/bin/omms-launch.mjs` with `web --login-item`. The launcher starts the newest valid copy at each login, so an update does not change the item. `web install` places the launcher first.
- It prints the web app URL from `webServerHost` and `webServerPort`, for example `http://127.0.0.1:4747`.
- For a Homebrew runtime, the item stores the stable link, for example `/opt/homebrew/bin/node`. It does not store the versioned `Cellar` path, so a Homebrew upgrade does not break the item.
- It exits with code `1` if the item is not installed.
- Before it starts the login item, it reads the version of any OMMS web app on the configured port:
  - An older web app receives a step-aside request. A standalone web app exits. An older web app inside an OpenCode session stops serving and the session keeps running. `web install` waits up to 10 seconds for the port, starts the login item, and prints `OMMS web app: <url> (version <version>)`.
  - An older web app from OMMS 3.5.0 or earlier has no step-aside route. `web install` prints the version and how to stop it. Stop that web app, then run `web install` again.
  - A web app of the same version keeps running. `web install` prints its version.
  - A newer web app keeps running. `web install` tells you to update the global command with `npm i -g om-memory-system`.
- An OpenCode start, a Pi start, and a Claude Code `SessionStart` do the same step-aside for a web app that is older than the newest recorded copy. You do not run `web install` after an update.

`om-memory-system web uninstall` sets `webServerAutoStart` to `false` and removes only OMMS's own item.

`om-memory-system web status` prints JSON with the setting, the item state, the web app URL, and whether a web app answers. It changes nothing.

`om-memory-system web update` brings the global install to npm `latest` and replaces the running web app.

1. It reads npm `latest`. When the global install is missing or older, it runs `npm install -g om-memory-system@<latest>` with the npm beside the Node.js that runs the command. When the global install is already on `latest`, it skips npm.
2. It stops every standalone OMMS web app: the web app on the port steps aside, and web apps that wait for the port exit. A web app inside an OpenCode session stops serving, and the session keeps running.
3. It starts one fresh web app through the login item, or through the launcher when no login item is installed. The launcher runs the newest copy on the machine.
4. It waits up to 15 seconds and prints `OMMS web app: <url> (version <version>)`.

- It works when no web app runs.
- When npm fails, times out after 5 minutes, or leaves another version, it prints a code (`permission`, `network`, `npm-exit`, `timeout`, `version-mismatch`), keeps the web app running, and exits with code `1`.
- When npm cannot be reached, it says so and still replaces the web app.
- A web app from OMMS 4.10.0 or earlier of the same version cannot be replaced from the terminal. The command names it and says how to stop it.
- When a host start or another `web update` holds a fresh start lock, it changes nothing, says so, and exits with code `1`. Run it again after a few seconds.
- It needs `webServerEnabled: true`.

`web status`, `web install`, and `web update` talk to the web app on this computer with the local token file (`~/.omms/.auth-token`). They do not read `webServerApiToken`.

Any other argument after `web` prints the usage and exits with code `1`.

Supported platforms are macOS, Linux with systemd user services, and Windows. On other platforms, or without a runtime, run `om-memory-system web` yourself.

The login item starts the standalone web app after sign-in. It uses the same data and settings as the hosts. See [Web UI](web-ui.md) for port ownership and authentication.

## Profile catch-up

`om-memory-system profile-catch-up` analyses every prompt that waits for profile learning. It does the same run as the **Catch up profile** button on the Settings page. See [Settings page: Profile learning](web-ui-settings.md#profile-learning).

```bash
om-memory-system profile-catch-up            # print the counts, make no model calls
om-memory-system profile-catch-up --yes      # start the run
om-memory-system profile-catch-up --dry-run  # print the counts only
```

Without `--yes`, the command prints the waiting prompts and the model calls, then exits:

```text
Waiting prompts: 2902
Model calls: 59 (batches of 50)
Run again with --yes to start.
```

| Flag                   | Effect                                              |
| ---------------------- | --------------------------------------------------- |
| `--yes`                | Start the run.                                      |
| `--dry-run`            | Print the counts only.                              |
| `--provider <type>`    | Provider type. Default: the saved `memoryProvider`. |
| `--model <id>`         | Model id. Default: the saved `memoryModel`.         |
| `--api-url <url>`      | API URL. Default: the saved `memoryApiUrl`.         |
| `--api-key-env <NAME>` | Read the API key from this environment variable.    |
| `--help`               | Print the flags.                                    |

- The model flags choose another model for this run only. The command does not save them.
- The run sends 50 prompts in each model call, oldest first. It prints the batches done and the prompts that still wait after each batch.
- The newest catch-up run takes over. If a run already works on the Settings page or in another terminal, this run waits until that run finishes its current batch, then continues. The older run stops and says that a newer run took over. No batch is sent twice.
- If this run is taken over, it prints `Stopped: a newer catch-up run took over.` and exits with code 0.
- A failed batch stops the run. The command prints the reason code, for example `Stopped: timeout`, and exits with code `1`. Finished batches stay learned. Run the command again to continue.
- A run needs a user email. OMMS reads it from git or from `userEmailOverride`.
- Error messages never contain the API key.

## Skill turns

While `skillLearning` is on, every history import also records each turn it reads into `skills.db`. This includes turns that the memory import ledger marks as handled and turns that live capture saved. The memory ledger does not change for these turns. A turn is recorded once: a second import adds no copy.

Use `--skip-skills` on an import to record no skill turns.

### Record past turns

`om-memory-system skills record-past` records past turns from every set-up host in one run. It reads Pi, OpenCode and Claude Code history from the default folders, for all projects, with no date limit. It makes no model call. It runs the same grouped import as **Record past turns** on the web page, so the Memory page shows its progress.

```bash
om-memory-system skills record-past            # print the counts, record nothing
om-memory-system skills record-past --yes      # start the run
om-memory-system skills record-past --dry-run  # print the counts only
```

```text
Pi: 2 recorded, 0 already present
Claude Code: 3 recorded, 0 already present
```

- A host is set up when its default history folder or database exists. Pi also needs its session reader.
- Sessions whose project folder no longer exists are recorded too, under the recorded folder path. A memory import still skips them until you map the folder.
- The run is safe to repeat. A second run with no new history reports every turn as already present.
- The command stops with exit code `1` when `skillLearning` is off, or when no host history exists.
- Progress goes to stderr. The counts go to stdout.

### Delete recorded turns

`om-memory-system skills delete-turns --yes` deletes every recorded turn, with its tool calls and skill uses. It then compacts `skills.db`, so the deleted text does not stay in the file. Proposals and saved skill versions stay. Without `--yes`, the command prints the number of recorded turns and deletes nothing.

```bash
om-memory-system skills delete-turns          # print the count
om-memory-system skills delete-turns --yes    # delete every recorded turn
```

### Skills and proposals

These modes run the same operations as the `skills` tool on Pi, OpenCode and Claude Code. They read the store and the watched skill folders for the current folder's project. `--directory <path>` chooses another project.

| Mode        | Flags                                                                                                                            | What it does                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list`      | `--order <uses\|attention>`                                                                                                      | List the skills, ranked by use in the last 30 days, or by attention with `--order attention`.                                      |
| `ideas`     |                                                                                                                                  | Find up to three new skill ideas in the recorded turns.                                                                            |
| `draft`     | `--skill <name or path>`                                                                                                         | Draft an improvement for a skill as a pending proposal.                                                                            |
| `draft`     | `--idea-name <name>`, `--idea-description <text>`, `--folder <folder>`; optional `--idea-reason <text>`, `--idea-evidence <ids>` | Draft a new skill in a watched folder as a pending proposal. The reason and evidence turns from `ideas` go into the draft request. |
| `evidence`  | `--skill <name or path>`, `--limit <1-20>`                                                                                       | Show a skill's `SKILL.md`, numbers and newest recorded turns, failed ones first.                                                   |
| `propose`   | `--skill` or the idea flags, `--content-file <path>`, `--summary`, `--evidence <ids>`                                            | Save a fixed `SKILL.md` as a pending proposal. No model call.                                                                      |
| `proposals` | `--state <state>`                                                                                                                | List proposals, newest first. The state filter is optional.                                                                        |
| `show`      | `--id <id>`                                                                                                                      | Show a proposal with its summary, evidence turns and diff.                                                                         |
| `apply`     | `--id <id>`                                                                                                                      | Write a pending proposal to its `SKILL.md`.                                                                                        |
| `reject`    | `--id <id>`                                                                                                                      | Reject a pending proposal.                                                                                                         |
| `undo`      | `--id <id>`                                                                                                                      | Restore the file an applied proposal changed.                                                                                      |
| `help`      |                                                                                                                                  | List the modes.                                                                                                                    |

```bash
om-memory-system skills list
om-memory-system skills draft --skill s-web-search
om-memory-system skills proposals --state pending
om-memory-system skills show --id <id>
om-memory-system skills apply --id <id> --json
```

- The state is `pending`, `applied`, `stale`, `rejected` or `undone`.
- `--skill` takes a skill name, or the full path of its `SKILL.md`. If two watched skills have the same name, give the path.
- `ideas` and `draft` call the external API model (`memoryModel`, `memoryApiUrl`, `memoryApiKey`). A draft changes no file. It saves a pending proposal.
- `apply` makes the same checks as the web page. It records that a person applied the proposal.
- `propose` reads the new `SKILL.md` from `--content-file`. Give `-` to read standard input. OMMS reads the current file and computes the base hash and diff. The same content prints `no-change`. Content over 100 KB is refused. `--evidence` takes turn ids such as `12,14`.
- `evidence` and `propose` make no model call. `evidence` stops with exit code `1` when `skillLearning` is off.
- `list`, `ideas`, `draft` and `evidence` stop with exit code `1` when `skillLearning` is off. The message tells you where to turn it on.
- The result goes to stdout as plain text. Add `--json` to get one JSON document with `success`, `mode`, `code`, `text` and `data`.
- A bad flag prints the error and the usage to stderr. A failed operation exits with code `1`.
- Error messages never contain the API key.

## Normalise profile categories

`om-memory-system profile-normalise-categories` repairs category spellings in the active user's profile. It makes no model calls.

1. Preview the proposed renames:

   ```bash
   om-memory-system profile-normalise-categories
   ```

2. Read every old label, new label and item count. Check the distinct category counts before and after.
3. Back up `~/.omms/data/user-profiles.db` before applying a live repair. Use your configured storage path if it differs.
4. Confirm the repair:

   ```bash
   om-memory-system profile-normalise-categories --yes
   ```

| Flag           | Effect                                  |
| -------------- | --------------------------------------- |
| `--yes`        | Save the proposed category renames.     |
| `--dry-run`    | Preview only, even with `--yes`.        |
| `--help`, `-h` | Print help without opening the profile. |

Without `--yes`, the profile stays unchanged. `Changes` counts renamed items. The repair preserves item order, item counts and every other item field. Workflows stay unchanged. Labels follow the [profile category rules](using-memory.md#how-profile-categories-are-matched).

Saving adds one profile changelog entry through `updateProfile`. The earlier snapshot remains available under the configured changelog retention limit. Keep the database backup for recovery after old entries expire. A second confirmed run reports `Changes: 0` and writes no entry.

The command resolves the user from `userEmailOverride`, git email, or the sole active profile when no email is available. Unknown flags exit with code `1`.

## Clean up profile categories

`om-memory-system profile-cleanup-categories` groups profile category names that mean the same thing, for example "Execution" and "Direct execution", and proposes one name per group. The spelling repair above only joins spellings of one name; this command joins different wordings of one meaning.

1. Preview the groups:

   ```bash
   om-memory-system profile-cleanup-categories
   ```

2. Read each group: the proposed name, then each old name with its item count. A group marked `not checked by the model` used the most used name because no profile model answered.
3. Apply every group:

   ```bash
   om-memory-system profile-cleanup-categories --yes
   ```

4. Undo the last cleanup if needed:

   ```bash
   om-memory-system profile-cleanup-categories --undo
   ```

| Flag           | Effect                                           |
| -------------- | ------------------------------------------------ |
| `--yes`        | Apply every group in the preview.                |
| `--undo`       | Restore the categories the last cleanup renamed. |
| `--help`, `-h` | Print help without opening the profile.          |

The preview embeds each distinct category name once with your embedder, then sends groups to the profile model, 20 per call, one call at a time, with up to three example descriptions per name. The model is the host model or the external API, as for the web app's AI Cleanup. Each call may take up to 180 seconds; a call that fails or times out leaves its groups named by their most used name. The preview saves each answer of the model as soon as its call returns. A later preview, for example after profile learning or a restart, asks the model only about groups that have no saved answer, so a rebuild checks the new groups and retries the groups that failed. Saved answers hold category names only. They are deleted after 30 days and when their group no longer exists.

A reasoning model is slow here. On one profile with 291 groups, each call took about 110 seconds, about 27 minutes in all for the first preview. If your provider can switch reasoning off, `memoryExtraParams` can pass that option; for z.ai GLM models, `"memoryExtraParams": { "thinking": { "type": "disabled" } }` cut a call to about 36 seconds. This setting applies to every external API call, including memory capture, so add it only if you accept that.

Applying only renames categories. Descriptions, evidence, counts and confidence stay unchanged, and no item is removed or merged. The apply works on the profile as stored when you run it, even when profile learning saved newer versions during the preview. It is refused only when another save lands while it writes. Then run the command again. Undo restores the old name on every renamed item that still exists, and reports items that later learning merged away. To choose groups one by one, use **Clean up categories** on the user profile page.

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
Code plugin calls it through its launcher. You do not run it by hand.

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
- One import per host runs at a time. A real import (not `--dry-run`) takes the host's lock in the store. A CLI run, a slash command, a web import, and a backfill for the same host cannot overlap. The second one stops with "A Pi import is already running", or the OpenCode or Claude Code version of that message.
- Every real import records its progress in the store. The Settings page shows a CLI run with its percentage and time left. If the terminal closes, the page shows the run as stopped. Run the command again to continue from the ledger.
- There is no undo command. Back up `~/.omms/data` before a large import if you may want to roll back.

## See also

- [OpenCode history import](opencode-history-import.md)
- [Pi history import](pi-history-import.md)
- [Claude Code adapter](claude-code-adapter.md)
- [Claude Code history import](claude-code-history-import.md)
- [Web UI settings](web-ui-settings.md)
- [Configuration: Choosing the model](configuration.md#choosing-the-model), for how live capture chooses its model
