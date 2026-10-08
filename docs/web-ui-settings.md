# Settings page

Settings holds API and model configuration, embedding, access controls, diagnostics, health, Claude Code's folder, profile identities, web app controls and logs. Memory operations live on the [Memory page](web-ui-memory.md).

Open `http://127.0.0.1:4747/settings`, select **Settings** in the sidebar, or select the cogwheel at the bottom of the sidebar. The arrow next to **Settings** opens a list of the page cards. Select a card to go straight to it. The sidebar remembers whether the list is open. One shared web app serves the page. OpenCode, Pi, and Claude Code start it when none runs, and the login item starts it at sign-in. See [Web UI](web-ui.md) for starting the web app, ports, and access control.

## How saving works

Configuration sections on Settings and Memory share one safe save flow to `~/.config/omms/omms.jsonc`. A save refreshes their shared revision; opening the other page reads the current settings.

- A save changes only the keys you changed. Comments, key order, and other keys stay as they are.
- The page never writes a project's `.opencode/omms.jsonc`. When a project file overrides a value, the page says so.
- If the file changed after the page loaded it, the save is refused. The page reloads the current values. Check them, then save again.
- If OMMS still reads the old `~/.config/opencode/opencode-mem.jsonc`, the first save copies it, comments included, to `~/.config/omms/omms.jsonc`. The old file is not changed. From then on OMMS reads the new file.
- Running hosts use saved memory limits at the next relevant search, injection, capture, or OpenCode profile-learning operation. You do not need to restart them. An operation already running keeps its original limits.
- A value that fails OMMS's startup checks is refused, and the file stays unchanged.
- The general save refuses the embedding keys and the browser password. Change them on the **Embedding** card and the **Keys and access** card.

The page never shows a secret. For a key it shows only whether it is set and where it comes from: a literal value, an environment variable (`env://NAME`), or a file (`file://path`).

## External API

An external API is an OpenAI- or Anthropic-compatible endpoint that you pay for with your own key, for example a Z.ai GLM plan. Any host can use it for live capture and for importing old chats. Claude Code capture, profile learning, and imports need it, because Claude Code has no other model path.

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

The rule for choosing a model is the same on OpenCode and Pi. See [Configuration: Choosing the model](configuration.md#choosing-the-model).

### Claude Code capture status

Claude Code has no model card. Its capture and profile learning always use the external API. A **Claude Code** box below the OpenCode and Pi model cards shows the status:

- When `memoryModel`, `memoryApiUrl`, and `memoryApiKey` are all set, it shows "Claude Code capture uses the external API."
- When one of them is missing, it shows "Claude Code capture is off. Complete the external API settings." A **Missing settings** line names each one, for example `memoryApiKey is not configured`.
- Retrieval and the `om-memory-system memory` command work while capture is off.

`GET /api/settings` returns the same status as `effective["claude-code"]`, with `ready`, `mode`, and `issues`. See [Claude Code adapter](claude-code-adapter.md).

### Model lists

The web app has no OpenCode session. OMMS starts a private `opencode serve` to read the list, and stops it after the read:

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

## Memory

Moved to [Memory limits](web-ui-memory.md#memory-limits). `/settings#settings-section-memory` redirects to `/memory#memory-section-limits`. Defaults, units, host coverage and safe-save rules remain unchanged.

## Embedding

The embedder is the model that turns memory text into search vectors. Search compares these vectors. Every memory in the store must use the same embedder, so a change re-embeds every memory.

The card is locked. It shows:

- **Kind:** **Built-in model** or **OpenAI-compatible server**.
- **Server URL**, for a server.
- **Model** and **Vector size**.
- **API key:** set or not set. The page never shows the key.
- **Stored memories:** the number of memories a change re-embeds.

The padlock shows only when you open the page on the computer that runs OMMS. From another computer, the card is read-only.

### Change the embedder

1. Select the padlock to unlock the card.
2. Choose **Built-in model** or **OpenAI-compatible server**.
3. For a server, choose a **Preset**. The preset fills the **Server URL**.
4. Type the exact **Model** name that the server or Hugging Face uses.
5. For a server, choose the **API key** source.
6. Select **Test**.
7. Check the vector size in the result.
8. Select **Apply**.
9. Read the confirmation, then confirm.

| Preset     | Server URL                     |
| ---------- | ------------------------------ |
| Ollama     | `http://localhost:11434/v1`    |
| llama.cpp  | `http://localhost:8080/v1`     |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI     | `https://api.openai.com/v1`    |
| Custom     | Type your own URL.             |

API key sources:

- **No key.** Use this for a server on your computer, such as Ollama or llama.cpp.
- **Keep the saved key.** Use the key that is set now.
- **Environment variable.** Type the variable name. OMMS saves `env://NAME`.
- **Key file.** Type the path to a file that holds only the key.
- **Save key to a private file.** Paste the key. OMMS writes it to `~/.config/omms/secrets/` and saves its `file://` path.

**Test** embeds one fixed sentence with the values in the form. It shows `Test passed. Vector size` and the size, or `Test failed` and the reason. The reason never contains the key. A test does not change the embedder that OMMS uses.

**Apply** is available only after a passing test of the values in the form. Change a value and you must test again. The server also refuses an apply without a passing test of the same values in the last 10 minutes.

The confirmation tells you:

- how many stored memories OMMS re-embeds;
- that a hosted server is called once for each memory, which may cost money;
- that search results are poor until the re-embed ends;
- to restart open OpenCode and Pi sessions after the change.

After you confirm, OMMS writes `embeddingApiUrl`, `embeddingModel`, `embeddingDimensions`, and `embeddingApiKey` in one save. It then re-embeds every memory. The card shows the progress.

- A failed run shows the reason and **Retry**. A retry re-embeds only the store files that are still out of date.
- **Cancel**, or locking the card again, drops your edits.
- The padlock stays disabled while a re-embed runs.

The routes are `GET /api/settings/embedding`, `POST /api/settings/embedding/test`, `POST /api/settings/embedding/apply`, and `GET` or `POST /api/settings/embedding/run`. The `POST` routes need a caller on this machine and the local token file (`~/.omms/.auth-token`). Other callers get `403`. Apply answers `202`. It answers `409` without a matching test or while a run works.

See [Configuration: Embeddings](configuration.md#embeddings) for the config keys.

## Keys and access

This card shows each credential that OMMS can use, in a table with the columns **Credential**, **State**, **Used for**, **Hosts**, and **Change it in**. It never shows a secret value.

| Row                  | Config key or file        | Used for                                                                           | Change it on              |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| External API key     | `memoryApiKey`            | Capture and profile learning through the external API. Claude Code always uses it. | the **External API** card |
| Embedding server key | `embeddingApiKey`         | Calls to an embedding server on another machine.                                   | the **Embedding** card    |
| API tokens           | `~/.omms/api-tokens.json` | Scripts and other computers that call the web app's API.                           | the table below           |
| Browser password     | `webServerAuthPassword`   | A user name and password before the page opens.                                    | the form below            |

Each row shows one state:

- ✅ **set**: the credential is set.
- ⛔️ **missing**: OMMS needs it and it is not set.
- grey **not needed**: OMMS does not need it with your settings.
- grey **never used before**: shown for the external API key when no host has used it yet.

When OMMS needs each one:

- **External API key:** when OpenCode or Pi uses the external API, or when there is evidence that you use Claude Code with OMMS. Evidence is a Claude Code capture that OMMS recorded, or a Claude Code folder that you saved in the [Claude Code folder](#claude-code-folder) card. A default `~/.claude` folder alone is not evidence, because Claude Code can be installed without the OMMS plugin. To mark the key as needed before your first Claude Code capture, save your folder in that card.
- **Embedding server key:** only for an embedding server that is not on this computer.
- **API tokens:** only when the web app listens on a host that is not loopback, and no browser password is set.
- **Browser password:** never marked as needed.

When `omms.jsonc` still sets `webServerApiToken`, the card shows a warning. OMMS imported that key once as the token `from config file` and does not read it any more. See [Upgrading: API tokens](upgrading.md#api-tokens-replace-webserverapitoken).

Open the page on the computer that runs OMMS to manage tokens and the password. From another computer, the card hides these controls and says so.

### API tokens

An API token lets a script or another computer call the web app's API. Send it as `Authorization: Bearer <token>` or in the `X-Omms-Token` header.

To create a token:

1. Type a **Token name**.
2. Choose **Expires after**: 7, 30, or 90 days, or **Never**.
3. Select **Generate token**.
4. Select **Copy**, and keep the token in a safe place.

The page shows the token value once. OMMS keeps only a hash of it, so nobody can show it again.

The table lists each token with its **Name**, **Created**, **Expires**, and **Last used** time. **Last used** updates at most once a minute. To stop a token, select **Revoke** and confirm. Scripts that use it then get `401`. An expired token also gets `401`.

The routes are `GET` and `POST /api/settings/tokens`, and `DELETE /api/settings/tokens/<id>`. They need a caller on this machine (`403` otherwise) and the local token file (`401` otherwise).

### Browser password

The browser password turns on HTTP Basic Auth. The browser then asks for a user name and password before the page opens.

- To set it, type the **Password** and, optionally, the **User name**. Then select **Save password**. The default user name is your computer user name.
- OMMS writes the password to `~/.config/omms/secrets/web-password.key` with mode `0600`. It saves `webServerAuthPassword: file://...` and `webServerAuthUsername` in the global config.
- **Clear password** removes both config keys and deletes the password file.
- Restart the web app to use a new password. Use the [power button](web-ui.md#power-button).

The route is `POST /api/settings/web-password`. It needs a caller on this machine and the local token file.

## Capture diagnostics

Every capture attempt writes one metadata record: host, model, sizes, stop reason, outcome, and failure reason. It never contains conversation text. This section shows those records.

- **Time range.** Show the last 24 hours, 7 days, 30 days, or 90 days.
- **Host.** Show all hosts, or only OpenCode, Pi, or Claude Code. The server applies the filter, so the recent list fills with the chosen host. The route is `GET /api/settings/diagnostics?host=opencode`, `pi`, or `claude-code`. Another value gets `400`.
- **Outcomes by host.** One row for each host: OpenCode, Pi, and Claude Code. Select a host row to show one row for each of its models. A note above the table explains the columns:
  - **Saved:** a memory was stored.
  - **Skipped:** the model or a rule found nothing worth keeping, or the turn was private or trivial.
  - **Failed:** the attempt hit an error.
  - **Total:** the three added up. Each percentage is a share of its row's total.
- **model not recorded.** A model row for attempts with no recorded model. This happens with records written by older OMMS versions, and when an attempt stops before a model is chosen. Older versions showed these as `—`.
- **Failure reasons.** The most common reasons for failed attempts, added up for each host and reason.
- **Recent attempts.** One row for each attempt, with its model, stop reason, sizes, duration, and outcome.
- **Attempt retention (days).** How long OMMS keeps these records. The default is 30 days.

The tables show host names: OpenCode, Pi, and Claude Code.

An attempt through the external API records the path `external-api`, the provider, and the model, on every host. It records them also when the call fails. Rows written by an older version are not changed, so they can show an empty model.

### Capture retry queue

When a live capture fails because the capture model cannot be reached, OMMS keeps a cleaned copy of the turn and tries it again later.

- **Retry retention (hours).** How long a waiting turn is kept. The default is 72 hours. The range is 0 to 720.
- Set it to 0 to turn the queue off. The save deletes the waiting turns at once.
- **Turns waiting for retry** shows the number of waiting turns for Pi, OpenCode, and Claude Code.
- **Retry now** retries the waiting turns of Pi and Claude Code at once. OpenCode's waiting turns retry at the next OpenCode session start, because only an OpenCode session can call OpenCode's models. The page says so.
- The web app always runs the Claude Code retry pass, so **Retry now** works for Claude Code in any web app.
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

A session model can be tested only from inside an open session. The web app cannot call an OpenCode signed-in model or a Pi session model. The **OpenCode model test** row then shows `warn` with the text `Skipped: an OpenCode signed-in model can be tested only inside OpenCode`. To test it, run a capture in OpenCode, or set the external API as the capture model.

Claude Code rows:

- **Claude Code model.** `pass` when the external API is fully set up. `fail` when it is not. The row names each missing setting, for example `memoryApiKey is not configured`. It never shows a key.
- **Claude Code folder.** `pass` when the Claude Code transcripts folder exists. `warn` with the path when it does not. See [Claude Code folder](#claude-code-folder).
- **Claude Code model test.** Only with **Run checks and test models**. It sends one short fixed prompt to the external API.

One health run makes at most one external API test call. The **OpenCode model test** row (when OpenCode uses the external API), the Pi manual-model test, and the **Claude Code model test** row share that call.

## Claude Code folder

Use this section when Claude Code does not keep its data in `~/.claude`, for example when you start it with `CLAUDE_CONFIG_DIR`.

- **Claude Code folder** (`claudeConfigDir`) is the folder, not its `projects` subfolder. Enter an absolute path or a path that starts with `~/`. The page refuses any other value.
- Leave the field empty to use the web app's `CLAUDE_CONFIG_DIR` variable, then `~/.claude`.
- **Transcripts folder in use** shows `<folder>/projects`. **From** says whether it comes from this setting, the variable, or the default.
- A warning shows when the folder does not exist. Claude Code capture then returns `400` for every turn, and the import screen finds no sessions.
- A save applies to the next capture and the next import. You do not restart anything.
- A project config cannot change this setting.

## Import and backfill

Moved and renamed to [Import chat history](web-ui-memory.md#import-chat-history). `/settings#settings-section-import` redirects to `/memory#memory-section-import`.

### Advanced options

See [Memory: Advanced options](web-ui-memory.md#advanced-options) for sources, dates, maps, batch size and re-analysis.

## Automatic import

See [Memory: Automatic import](web-ui-memory.md#automatic-import). `/settings#settings-section-auto-import` redirects to `/memory#memory-section-auto-import`.

### Run now, Pause, and Resume

See [Memory: Run now, Pause and Resume](web-ui-memory.md#run-now-pause-and-resume).

## Profiles

Profile identity controls remain in Settings at `/settings#settings-section-profiles`. OMMS keeps one user profile for each git email. A repository with its own `user.email` can start a second profile. The **Profiles** card appears only when more than one active profile exists.

Choosing **All hosts** on Memory preserves those identity rules and does not merge different emails. [Profile learning](web-ui-memory.md#profile-learning) operates on prompts; choosing and merging identities stays here.

- The table lists each profile's email, its numbers of preferences, patterns, and workflows, the prompts analysed, and its last update. ✅ **in use** marks the profile OMMS uses now.
- **Use this profile** saves its email as `userEmailOverride` in the global config. Every folder then uses that profile.
- **Merge into** combines one profile into the profile you choose, with the same matching rules as profile learning. The page asks you to confirm. The source profile is turned off, not deleted, and the target gets a changelog entry.

The routes are `GET /api/settings/profiles`, `POST /api/settings/profiles/use` with `{ userId, revision }`, and `POST /api/settings/profiles/merge` with `{ sourceId, targetId }`.

## Profile learning

See [Memory: Profile learning](web-ui-memory.md#profile-learning) for **Analyse waiting prompts** and **Re-analyse chat history**. `/settings#settings-section-profile` redirects to `/memory#memory-section-profile`. Identity controls stay in [Profiles](#profiles).

## Directory maps

Moved and renamed to [Resolve missing project folders](web-ui-memory.md#resolve-missing-project-folders). `/settings#settings-section-directory-maps` redirects to `/memory#memory-section-project-folders`. Old `/settings#directory-maps-pi`, `...-opencode` and `...-claude-code` links redirect to the matching host disclosure on Memory.

### Suggestions

See [Memory: Suggestions](web-ui-memory.md#suggestions).

### Smart resolve

See [Memory: Smart resolve](web-ui-memory.md#smart-resolve).

## Web app

- **Start web app at login** (`webServerAutoStart`) installs or removes a login item that starts the web app when you sign in. The change applies at the next Pi or OpenCode start. The power button in the sidebar restarts or stops the web app. See [Web UI: Power button](web-ui.md#power-button). To apply it now, run `om-memory-system web install` or `om-memory-system web uninstall`.
- **Login item** shows whether the item is installed, unsupported on this system, or missing a Node or Bun runtime. The item runs the launcher at `~/.omms/bin/omms-launch.mjs`, which starts the newest OMMS copy at each login.
- **Running version** is the OMMS version that serves this page. **Global command** is the version of the global install. OMMS reads it from the install's `package.json` and does not run the command. It looks for the command on the web app's `PATH`, then for the install beside the Node.js that runs the web app. A login item runs with a short `PATH`, so the second place matters. It shows `not installed globally` when neither has an install.
- When the global install is older than the running version, the section says that a newer copy runs in its place and that the global install is optional. It shows the command that updates it: `npm i -g om-memory-system@latest`.
- When the global install is newer than the running version, the section warns you. The next Pi or OpenCode start replaces the web app.
- When no global install exists, the section says that a global install is optional.

See [CLI: Global install](cli.md#global-install-optional) and [Updating and upgrading](upgrading.md#one-update-updates-every-host).

## Log

This section shows the latest lines of `~/.omms/omms.log`.

- **Capture attempts only** shows only capture attempt records.
- **Refresh** reads the log again.
- **Copy log path** copies the file path.

The log holds sizes, identifiers, and codes. It never holds prompts, replies, or keys.
