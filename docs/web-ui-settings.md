# Settings page

This guide explains each part of the web app's Settings page, in the order the page shows them.

Open `http://127.0.0.1:4747/settings`, or select the cogwheel at the bottom of the sidebar. OpenCode serves the page while it runs. The login web app and `om-memory-system web` serve it without an agent open. See [Web UI](web-ui.md) for starting the web app, ports, and access control.

## How saving works

Every section saves to the global config file, `~/.config/omms/omms.jsonc`.

- A save changes only the keys you changed. Comments, key order, and other keys stay as they are.
- The page never writes a project's `.opencode/omms.jsonc`. When a project file overrides a value, the page says so.
- If the file changed after the page loaded it, the save is refused. The page reloads the current values. Check them, then save again.
- If OMMS still reads the old `~/.config/opencode/opencode-mem.jsonc`, the first save copies it, comments included, to `~/.config/omms/omms.jsonc`. The old file is not changed. From then on OMMS reads the new file.
- Running Pi and OpenCode use the saved values from their next capture. You do not need to restart them.
- A value that fails OMMS's startup checks is refused, and the file stays unchanged.

The page never shows a secret. For a key it shows only whether it is set and where it comes from: a literal value, an environment variable (`env://NAME`), or a file (`file://path`).

## External API

An external API is an OpenAI- or Anthropic-compatible endpoint that you pay for with your own key, for example a Z.ai GLM plan. Either host can use it for live capture and for importing old chats.

The card sets four values:

| Field    | Config key       | What to enter                                                                                               |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Provider | `memoryProvider` | The API style: `openai-chat`, `openai-responses`, `anthropic`, `minimax`, `orcarouter`, or `google-gemini`. |
| API URL  | `memoryApiUrl`   | The endpoint, for example `https://api.z.ai/api/coding/paas/v4`. Not needed for `orcarouter`.               |
| Model    | `memoryModel`    | The model name at that endpoint, for example `glm-5.3`. Not needed for `orcarouter`.                        |
| API key  | `memoryApiKey`   | Where the key comes from. See the three key sources below.                                                  |

Select **Save endpoint** to save the provider, URL, and model.

### Key sources

Choose one source, then select **Save key source**.

- **Environment variable.** Type a variable name, such as `ZAI_API_KEY`. OMMS saves `env://ZAI_API_KEY`.
- **Key file.** Type the path of a file that holds only the key. The file must exist. OMMS saves `file://` and the path.
- **Save key to a private file.** Type a file name and paste the key. OMMS writes it to `~/.config/omms/secrets/<name>.key` and saves its `file://` path.

What happens to a pasted key:

- The file can be read only by you: mode `600` in a folder with mode `700` on macOS and Linux, and a user-only access list on Windows.
- The key is never written to `omms.jsonc`, the log, or any page response. The page does not show it again.
- If a key file with that name exists, the page asks before it replaces it.
- On a server bound to a network address without Basic Auth, the page refuses to save a pasted key.

The card also shows:

- **Key source.** The saved source type and the variable name or file path.
- **Resolves in the web app.** Whether the key can be read by the process that serves this page.

A login web app does not load your shell profile, such as `~/.zshrc`. A variable set only there does not reach it, and the card says the key does not resolve. Use a key file for the login web app. A key file works in every OMMS process.

### Test

Select **Test** to send one short request with the saved settings and a small output limit. The card shows `Test call succeeded` with the model, or `Test call failed` with the error. The error never contains the key.

## Models

This section chooses the model for automatic capture and profile learning, one card for each host. Automatic capture is the summary OMMS writes after each exchange. Profile learning builds your user profile from your prompts.

Each card offers three choices:

- **Session model.** Use the model of the session you are working in. Saves `inherit` to `opencodeModel` or `piModel`.
- **Manual model.** Use one model from the host's own sign-in. Saves the provider and model, for example `piProvider: "openai-codex"` and `piModel: "gpt-5.6-luna"`. When the page can list the host's signed-in models, pick one. Otherwise type `provider/model`.
- **External API.** Use the endpoint from the External API card. Saves `external`. You can choose it only when the external API is fully set up. Until then the card lists the missing settings, for example `External API needs: memoryApiUrl`.

Each card also shows, without letting you change it:

- **Effective model.** The model the capture rule would use now.
- **External API fallback.** The external model used when a manual host model fails.
- A warning when a project config overrides the host's model.

The rule for choosing a model is the same on both hosts. See [Configuration: Choosing the model](configuration.md#choosing-the-model).

### Model lists

Inside an OpenCode session, the OpenCode card lists the session's signed-in models. The login web app and `om-memory-system web` have no OpenCode session. There, OMMS starts a private `opencode serve` to read the list, and stops it after the read:

- The server listens only on `127.0.0.1`, on a free port, with a password that OMMS makes for that start.
- OMMS finds `opencode` in `~/.opencode/bin`, then on `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.bun/bin`. It does not read your shell profile.
- OpenCode's reply contains provider API keys. OMMS keeps only the provider, model ID, and name. The keys never reach the page, the log, or error messages.
- OMMS keeps a list for 5 minutes, so a reload does not start OpenCode again. A failed read is kept for 30 seconds.
- The server starts in your home folder, so it reads OpenCode's global config only. Type a provider that you set up only in a project's `opencode.json` as `provider/model`.

The Pi card reads Pi's sign-ins in the OMMS process, with or without a session.

When a list is not available, the card and the Automatic import section show why, and what to do:

| Message starts with                                      | Cause                                                               | What to do                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| OMMS could not find OpenCode on this computer            | `opencode` is in none of the folders above.                         | Type `provider/model`, or open an OpenCode session and reload the page. |
| OpenCode took too long to send its model list            | OpenCode did not start in 10 seconds, or sent no list in 5 seconds. | Reload the page to try again, or type `provider/model`.                 |
| OpenCode has no signed-in models                         | OpenCode answered with an empty list.                               | Run `opencode auth login`, then reload the page.                        |
| This OpenCode version sent a model list OMMS cannot read | OpenCode's reply has a format that OMMS does not know.              | Type `provider/model`. Update OMMS if this continues.                   |
| OMMS could not read Pi's model list                      | The Pi SDK did not load.                                            | Type `provider/model`.                                                  |
| Pi has no signed-in models                               | No Pi provider has a sign-in.                                       | Sign in to a provider in Pi, then reload the page.                      |
| OpenCode model list unavailable                          | The OpenCode session could not give its list.                       | Type `provider/model`, or reload the page.                              |

Health checks, test calls, and history imports that use an OpenCode model still need an OpenCode session.

## Capture diagnostics

Every capture attempt writes one metadata record: host, model, sizes, stop reason, outcome, and failure reason. It never contains conversation text. This section shows those records.

- **Time range.** Show the last 24 hours, 7 days, 30 days, or 90 days.
- **Outcomes by model.** Saved, skipped, and failed counts for each host and model.
- **Failure reasons.** The most common reasons for failed attempts.
- **Recent attempts.** One row for each attempt, with its model, stop reason, sizes, duration, and outcome.
- **Attempt retention (days).** How long OMMS keeps these records. The default is 30 days.

### Capture retry queue

When a live capture fails because the capture model cannot be reached, OMMS keeps a cleaned copy of the turn and tries it again later.

- **Retry retention (hours).** How long a waiting turn is kept. The default is 72 hours. The range is 0 to 720.
- Set it to 0 to turn the queue off. The save deletes the waiting turns at once.
- **Turns waiting for retry** shows the number of waiting turns for Pi and for OpenCode.
- **Retry now** retries that host's waiting turns at once when the host runs this web server. Otherwise the page says the turns retry at that host's next session start.
- **Retry now** is disabled when the host has no waiting turns or the queue is off.
- Queued turns can contain conversation content. OMMS removes text inside `<private>` tags and common API key formats first.

### Capture traces

A trace is the full prompt and reply of each capture attempt, saved to `~/.omms/traces/` for debugging.

- **Save capture traces** turns tracing on or off. Tracing is off by default.
- Traces can contain conversation content. OMMS removes text inside `<private>` tags and common API key formats first.
- Trace files can be read only by you, and are deleted after **Trace retention (days)**. The default is 7 days.
- **Trace files** lists each day's file. **View** opens one. **Delete** removes it.
- A project config can turn tracing off but never on. On a network-bound server without Basic Auth, the page refuses to turn tracing on.

Turn tracing on only while you debug a problem.

## Health

This section runs checks on the parts OMMS needs, and shows a pass, warning, or fail line for each.

- **Run checks.** Check the config files, the memory store, the embedding model, the web binding, the model selection, and the capture failure rate over the last 24 hours.
- **Run checks and test models.** Also send one short fixed prompt to each host's capture model.

A session model can be tested only from inside an open session. The OpenCode web server cannot call a Pi session model.

## Import and backfill

Use this section to import past chats by hand. A backfill is an import of old chats; the next section runs one automatically.

1. Choose the **History host**: Pi or OpenCode.
2. Select **List sessions**. The list shows each session's date, ID, project folder, and how the folder was found. It never shows prompts or replies.
3. Tick sessions, or select **Select all matching** to include every page.
4. Select **Preview (dry run)**. It counts the exchanges that would be imported. It makes no model calls and writes nothing.
5. Choose the **Import model**: a connected OpenCode model, or **Saved external API**.
6. Select **Start import**.

While an import runs, progress updates every second. **Cancel after current unit** stops at a safe point. A later run imports the rest. The page, the terminal commands, and the automatic backfill share one record of finished work, called the ledger, so nothing is imported twice.

How the folder was found (**Resolved by**):

- **recorded.** The folder the session was recorded in still exists.
- **mapped.** A directory map sends the session to another folder.
- **project root.** OpenCode only. The recorded folder is gone, so OMMS uses the project folder OpenCode recorded.
- **missing.** No folder could be found. The session cannot be imported until a directory map resolves it.

The page keeps the preview and the import on the same sessions:

- If a session appears or disappears after you list them, the page asks you to refresh the list.
- Turns written after you listed the sessions wait for the next run. The report says how many.
- If you change the scope, project, source, or directory maps, the page asks you to refresh the list first.

### Advanced options

Select **Advanced options** to see these fields.

| Option                                      | Effect                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Source                                      | Pi: a sessions folder or one `.jsonl` file. OpenCode: a database file. The default is the host's own store. |
| Scope                                       | **Current project** or **All projects**.                                                                    |
| Project directory                           | The project for the current-project scope.                                                                  |
| Prompt date from, Prompt date to            | Import only turns from these whole days, in your browser's time zone.                                       |
| Directory maps                              | `old=new`, one per line. They apply to this import and win over saved maps for the same folder.             |
| Profile batch size                          | Prompts per profile analysis request.                                                                       |
| Force reimport, Skip memories, Skip profile | Import finished units again, or skip one of the two import steps (memories or the user profile).            |

Other details:

- **Browse** lists one folder at a time. It works only when the server is bound to `127.0.0.1`. On a network address, type the path instead.
- The server reads files in place and never changes them.
- While OpenCode runs, the server reads a private copy of its database. It first checks that the temporary folder has space for the copy.

**Model readiness.** A real import needs a connected OpenCode model, when OpenCode serves the page, or a fully set up external API. A web import cannot use a Pi sign-in. `Configured, not tested.` means the settings are present. Use **Test models in Health** to try a call.

## Automatic import

An automatic import, or backfill, imports each host's old chats in the background. It starts about 30 seconds after Pi or OpenCode starts. It makes model calls, so it costs what your model costs.

- **Import past chats automatically** turns backfill on or off for both hosts (`autoBackfill`). Turning it off stops a running backfill after its current exchange.

For each host:

- **Backfill model.** The model that imports old chats.
  - **Same as live capture** uses the model from the Models section. Saves `inherit`.
  - **External API** uses the External API card. Saves `external`. It can run from the web app with no host open.
  - A listed or typed `provider/model` uses another model from the host's sign-in, for example a cheaper one. Live capture keeps its own model.
- **State.** Not started, running, paused, stopped, done, or failed. For a running import it also shows where it started: automatically, from the web page, from the terminal, or from a slash command.
- **Progress.** A bar, the percentage, done out of total, and the minutes left. Minutes left comes from the recent rate. It shows as unknown until about a minute of progress.
- **Counts.** Imported, skipped, failed, and pending exchanges, and sessions whose folder cannot be found. When there are any, a link goes to [Directory maps](#directory-maps).
- **Model**, **Cutoff**, and the last error. The cutoff is fixed at the first backfill. Later turns are saved by live capture instead.

The page refreshes these values every 3 seconds while an import runs. Progress counts only exchanges that need a model call. Exchanges already in the ledger are left out.

Only one import runs for each host at a time. This includes a backfill, a page import, a terminal import, and a slash command. A second one is refused with `A Pi import is already running`.

### Run now, Pause, and Resume

- **Run now** starts the host's backfill at once. It uses the same cutoff, maps, model rule, and ledger as the automatic run.
- **Pause** stops the run after its current exchange, including a run in another process. A paused backfill does not start again when the host starts.
- **Resume** clears the pause and starts the run. It continues from the ledger.

Run now and Resume run inside the web app. Without Pi or OpenCode open, they need the host's backfill model to use the external API. Otherwise the page says: `Open Pi, or choose the external API for Pi's backfill`. When OpenCode serves the page, OpenCode's backfill can also use OpenCode's connected models.

## Directory maps

A directory map tells OMMS which project a folder belongs to. Use it when chats were recorded in a folder that no longer exists, such as a deleted git worktree.

- **Saved maps** lists the maps in `importPathMaps`. **Remove** marks one for removal, and **Keep** undoes that.
- **Unresolved directories** lists, for each host, the folders the latest session listing or import could not find, with a session count.
- Where OMMS can find one, the target box holds a suggested existing folder:
  1. The main repository of a deleted worktree. For `~/code/app-feat-x` or `~/workspaces/app/feat-x`, it suggests `~/code/app`.
  2. For OpenCode, the project folder that OpenCode recorded for the session. OMMS reads OpenCode's database without writing to it.
- `No suggestion found.` means there is no candidate, for example for an old temporary folder. Type a target, or leave the folder unmapped.

To save maps:

1. Check or edit the target folder.
2. Tick **Use this map**.
3. Select **Save maps**.

Maps apply to the next import or backfill run, on every surface. A terminal `--map` for the same folder wins for that run. A map to a folder that does not exist leaves its sessions unresolved. Memories already imported through a map stay when you remove it.

The list fills when you list sessions under Import and backfill with All projects, or when an import or backfill runs.

## Web app

- **Start web app at login** (`webServerAutoStart`) installs or removes a login item that starts the web app when you sign in. The change applies at the next Pi or OpenCode start. To apply it now, run `om-memory-system web install` or `om-memory-system web uninstall`.
- **Login item** shows whether the item is installed, unsupported on this system, or missing a Node or Bun runtime.
- **Running version** is the OMMS version that serves this page. **Global command** is the version of `om-memory-system` on the web app's `PATH`, or `not installed globally`.
- When the two versions differ, the section warns and shows the upgrade command: `npm i -g om-memory-system@latest`.

A global install is optional but recommended. With it, the login item and the terminal commands run without `npx`. See [CLI: Global install](cli.md#global-install-optional-recommended).

## Log

This section shows the latest lines of `~/.omms/omms.log`.

- **Capture attempts only** shows only capture attempt records.
- **Refresh** reads the log again.
- **Copy log path** copies the file path.

The log holds sizes, identifiers, and codes. It never holds prompts, replies, or keys.
