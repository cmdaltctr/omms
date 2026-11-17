# Settings page

Settings holds the memory switches, automatic cleanup, API and model configuration, embedding, access controls, diagnostics, health, Claude Code's folder, profile identities, skill learning, web app controls and logs. Memory operations live on the [Memory page](web-ui-memory.md).

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

## Search, problems and the save pattern

### Search box

A search box sits above the cards. Type a word, for example `reranker`. The list shows each setting that the web UI can change whose plain name, description or config key contains the word. Each result shows its name, a short description and the page it lives on. Select a result to open that page at its card. Settings on the Memory page, such as the reranker, open the Memory page. In Arabic, a word typed without short vowels finds the same settings.

When nothing matches, the box says that some settings live only in the config file. It names the [Configuration guide](configuration.md).

### Config problem banner

When OMMS finds a problem while it reads a config file, a banner shows above the cards:

- A file OMMS cannot read starts with one plain sentence in the page language: the settings file has an error, so until you fix it OMMS uses the last settings it could read, or its defaults if it has none. The file, the line and the column follow once in small text. The server sends these as separate fields, so the page words the sentence itself; the English sentence stays for the hosts and the log.
- A value that OMMS cannot accept starts with a plain sentence that names the setting and the values it accepts, in the page language. The key, the file and the line follow in small text. OMMS uses the default for that key until you fix the file.
- For a few keys a default would delete memories, call a paid model or start the web app at login. A bad value there turns the feature off instead, and the banner says which feature is off. See [Configuration: Troubleshooting](configuration.md#troubleshooting).

A bad value in the file does not stop you saving other settings. The page refuses a save only for a bad value in the setting you save. When the global file cannot be read at all, every **Save** and **Apply** button on the Settings and Memory pages is off, with one line that says why. The cards then show the last settings OMMS could read, which the running web app still uses, and the banner says so. A row says "default" only when that file did not set the key. Fix the file, then reload the page. The banner never shows the text of your file or the rejected value. OpenCode, Pi and Claude Code show the same problem once at the start of a session.

### Plain setting rows

Each setting row shows a plain name, one line that says what it does, its default and what it changes. The config key shows below in small text, for example `autoCaptureEnabled`. Search finds a setting by any of these.

### One save pattern

Every card with a server follows the same steps:

1. Edit the values.
2. Select **Test**, where the card has one. The test uses the values in the form, saved or not.
3. Select **Save**. Leaving a field saves nothing.
4. Read the plain message that follows.

You can clear an optional field, such as the API URL or the model. Saving an empty field removes its key from the file. A URL field accepts only `http://` or `https://` addresses. A number that is not valid shows a message next to the field and keeps **Save** off.

A save that deletes stored data opens a confirmation first. It says what OMMS deletes and how many items, when OMMS knows the count. Nothing is saved until you confirm. The confirmation has **Cancel** as its first choice.

### Key entry

The External API, Embedding and Reranker cards use one key control. Choose how OMMS gets the key:

- **Environment variable.** Type the variable name. OMMS saves `env://NAME`.
- **Key file.** Type the path of a file that holds only the key.
- **Save key to a private file.** Paste the key once. OMMS writes it to a file that only you can read, in `~/.config/omms/secrets/`, and saves its `file://` path. The page never shows the key again.
- **No key.** Offered where the key is optional, as on the Embedding and Reranker cards.

The control warns that a web app started at login does not see variables set only in your shell profile. A key file works everywhere. It also shows where the saved key comes from and whether the web app can read it.

## Memory basics

The first card holds the main switches. They apply to OpenCode, Pi and Claude Code.

| Switch                      | Config key            | What it does                                                      |
| --------------------------- | --------------------- | ----------------------------------------------------------------- |
| Save memories automatically | `autoCaptureEnabled`  | Saves a short memory from your sessions as you work.              |
| Recall memories in prompts  | `chatMessage.enabled` | Adds the memories that match your prompt.                         |
| Show recall rows            | `visibleRecall`       | Shows a line in the terminal each time memories are added.        |
| Add your profile to prompts | `injectProfile`       | Adds your learned preferences to the memories the agent gets.     |
| Where a search looks        | `memory.defaultScope` | **This project** or **All projects**, when a search does not say. |

Select **Save** to write the changed keys to the global config. Turning recall off keeps the other `chatMessage` keys. When the current project's file sets one of these keys, the row says that this project's file decides it there. The page writes the global file only.

## Memory cleanup

This card holds the only switch that turns on automatic deletion of memories.

- **Delete old memories automatically** (`autoDeleteOldMemories`) is off by default.
- **Days before a memory is old** (`autoCleanupRetentionDays`) is 30 by default.

The card warns you that deletion removes memories that are not pinned and have not changed for that many days, in every project, and that OMMS cannot restore a deleted memory. A project file cannot change these two settings. OpenCode, Pi and Claude Code follow the same switch.

Turning the switch on, or lowering the number of days while it is on, opens a confirmation first. It states how many memories have not changed for that many days, and that OMMS deletes them at its next daily check, not when you save. OMMS counts them with the same selection the deletion uses and deletes nothing while it counts. The number is what goes: the check deletes old prompts and the memories captured from them in the same run. The confirmation also says that pinned memories and memorisations stay. It has **Cancel** as its first choice. Nothing is saved until you confirm, and **Cancel** puts the switch back to its saved state. When OMMS cannot read the count, the confirmation says so and does not let you turn deletion on. Turning the switch off needs no confirmation.

The older `autoCleanupEnabled` key was removed in 7.0.0. OMMS ignores it, so a file that still sets `"autoCleanupEnabled": true` deletes nothing. Only the switch on this card turns deletion on. OMMS does not change your file by itself.

When a value in the file turns deletion off for this load, for example days written as text, the card shows the switch off with one line that points to the banner. Saving the card then also writes the days, which replaces the rejected value.

Each run that deletes something writes one line to the log, `Cleanup: old memories deleted`, with the number of memories and prompts, the days and whether the daily check or the **Cleanup** button ran it. The line never holds memory text, ids or project names.

Housekeeping, such as removing old capture attempt records, runs every day whatever this switch says. See [Configuration: Memory cleanup](configuration.md#memory-cleanup) for the keys.

## External API

An external API is an OpenAI- or Anthropic-compatible endpoint that you pay for with your own key, for example a Z.ai GLM plan. OpenCode, Pi and Claude Code can all use it for live capture and for importing old chats. Claude Code capture, profile learning, and imports need it, because Claude Code has no other model path.

The card sets four values:

| Field    | Config key       | What to enter                                                                                                                                      |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider | `memoryProvider` | The API style, shown by name: **OpenAI Chat Completions**, **OpenAI Responses**, **Anthropic**, **MiniMax**, **OrcaRouter**, or **Google Gemini**. |
| API URL  | `memoryApiUrl`   | The endpoint, for example `https://api.z.ai/api/coding/paas/v4`. Not needed for `orcarouter`.                                                      |
| Model    | `memoryModel`    | The model name at that endpoint, for example `glm-5.3`. Not needed for `orcarouter`.                                                               |
| API key  | `memoryApiKey`   | Where the key comes from. See the three key sources below.                                                                                         |

Select **Save settings** to save the provider, URL, model and key. **Save settings** first runs the same test as **Test**, once, with the values in the form, and saves only when the test passes. A key the provider refuses (HTTP 401 or 403) is never saved, and the card says nothing was saved. When OMMS cannot reach the address at all (a network error or a timeout), a dialog asks whether to save anyway or cancel. Empty the API URL or the model and save to turn the external API off and remove the key from the file; that save needs no test. The hint under each field says so: an empty field turns the external API off, except for OrcaRouter, which has its own address and picks its own model. The URL must start with `http://` or `https://`.

### Preset

The **Preset** list has two choices: **Custom** and **OpenRouter**.

- **OpenRouter.** Fills the API URL `https://openrouter.ai/api/v1` and the provider `openai-chat`. It does not change the model or the key source.
- **Custom.** Clears the API URL field, so you can type your own URL. It does not change the provider, the model or the key source.

The preset only fills the form. Select **Save settings** to save the values.

The list shows **OpenRouter** for any API URL on the host `openrouter.ai`, whether you chose the preset or typed the URL. For these URLs the card also shows the [OpenRouter routing](#openrouter-routing) block.

For an OpenRouter URL, the **Model** field suggests OpenRouter model IDs as you type. For example, type `deepseek` to see the `deepseek/...` models. The web app reads OpenRouter's public model list without your key and keeps it for one hour. You can still type any model ID. If the list cannot be read, the field works as a plain text field.

### Key sources

Choose one source with the shared [key control](#key-entry), then select **Save settings**. The card checks the key source first, saves the key, then the endpoint values. A key OMMS refuses saves nothing. After a save the key fields are empty.

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

Select **Test** to send one short request with the values in the form, saved or not, and a small output limit. On success the card names the provider by its display name and the model, for example "The test call worked: OpenAI Chat Completions, model glm-5.3." On failure it shows one plain sentence in the page language, with the HTTP status as small text:

| Result                        | Sentence                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------- |
| 401 or 403                    | The provider refused the key. Check the key, then test again.                 |
| 404                           | The address or the model was not found. Check both.                           |
| 429                           | The provider got too many requests. Wait a minute, then test again.           |
| 500 to 599                    | The provider had a problem on its side. Try again later.                      |
| Network error or timeout      | OMMS could not reach the address. Check the address and your network.         |
| Address, model or key missing | Some settings are missing. Fill in the address, the model and the key.        |
| Any other failure             | The test call failed. Check the provider, the address, the model and the key. |

The card never shows the provider's reply. A pasted key is used for that one request and is not saved or logged.

### OpenRouter routing

OpenRouter sends each request to one of several providers. Some providers keep prompts, and some train on them. The **OpenRouter routing** block lets you choose which providers may see your memory text. The block shows when the API URL is on `openrouter.ai`. See [Preset](#preset).

The block has two switches:

| Switch                                          | OpenRouter field          | Effect                                                             |
| ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| Block providers that may train on or store data | `data_collection: "deny"` | OpenRouter skips providers that may store or train on prompts.     |
| Zero data retention only                        | `zdr: true`               | OpenRouter uses zero data retention endpoints. See the note below. |

OpenRouter enforces both switches on every request, including requests that fall back to another provider.

**Zero data retention only** follows your OpenRouter account. When your account allows Safety Retention, OpenRouter can still use endpoints that keep prompts for abuse checks. The card labels them **Abuse checks only**. Self-serve accounts allow Safety Retention unless you change it. For strict no retention, set **ZDR only** in your OpenRouter privacy settings or in a guardrail. The card shows this note under the switches.

#### Provider list

Type the model ID on the card in the form `author/model`, for example `deepseek/deepseek-chat`. The card then lists each provider that serves the model, once, with one label:

| Label                         | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| **No retention**              | The provider is on OpenRouter's zero data retention list.              |
| **Abuse checks only**         | The provider is on that list, and keeps prompts only for abuse checks. |
| **May keep or train on data** | The provider is not on the zero data retention list.                   |

A provider can serve a model through several endpoints. The card shows the label of its least private endpoint.

Each provider also shows its OpenRouter price for the model, for example `$0.26 in · $0.71 out / 1M tokens`. "In" is the price of the prompt and "out" is the price of the reply, in US dollars per million tokens. For a provider with several endpoints, the card shows the lowest prices. A free provider shows **Free**. A provider with no listed price shows no price.

The labels give information. The switches are what OpenRouter enforces. A label can be up to one hour old. A switch is checked on each request.

To choose providers:

1. Tick the providers you want. The number next to each tick is its try order. OpenRouter tries the lowest number first.
2. Type a provider slug, for example `deepinfra`, and select **Add provider**. Use this for a provider that the list does not show. A slug can use letters, digits, dot, dash and underscore. It can also be a full endpoint slug with up to two more parts after a slash, for example `google-vertex/us-east5`, to keep routing to one region or variant.
3. Select **Remove provider** (the cross) to remove a slug you added by hand.
4. Turn on **Use only these providers** to stop OpenRouter from using any other provider. A request then fails when no ticked provider can serve it. The switch is disabled until you tick at least one provider that is not disabled.
5. Select **Save routing**. The card shows `Routing saved.` until you change a switch or a provider.

When **Zero data retention only** is on, rows labelled **May keep or train on data** are disabled. The card shows the reason `Not available while Zero data retention only is on.` Such a row is not saved, even if you ticked it earlier.

**Save routing** is separate from **Save settings**. It saves only the routing choice. Save the OpenRouter endpoint first: **Save routing** stays disabled until the saved API URL is on `openrouter.ai`, and the server refuses a routing save for any other saved URL. Other APIs can reject the `provider` field. **Save routing** also stays disabled while the model typed on the card differs from the saved model. The providers shown are for the typed model, and OMMS calls the saved model, so select **Save settings** first.

#### What the card sends to OpenRouter

To build the list, the web app reads two public OpenRouter lists on the server. The page does not contact OpenRouter.

- It sends only the model ID. It sends no API key and no memory text.
- It caches the zero data retention list for up to one hour. It does not cache the provider list of a model.
- Each request has a time limit of 10 seconds.

If the list cannot be read, the card shows `The provider list is not available.` and one of these reasons:

- `OpenRouter did not answer within 10 seconds.`
- `OpenRouter could not be reached.` This covers an error status and a reply in an unknown form.

For any other error, the card shows the server's message as a small detail line.

If OpenRouter knows no providers for the model ID, the card shows `OpenRouter has no providers for this model.` The switches, the slug field and **Save routing** still work in all of these cases.

#### Where the choice is saved

**Save routing** writes the choice to `memoryExtraParams.provider` in the global config. See [`memoryExtraParams.provider` for OpenRouter](configuration.md#openrouter-provider-routing).

- The card keeps every other `memoryExtraParams` member, such as `thinking`.
- The card keeps every `provider` field it does not manage, such as `sort`. When such a field exists, the card says `Other routing fields are set in the config file and are kept.`
- When you clear every switch and provider and save, the card removes `provider`. It removes `memoryExtraParams` when nothing else is left in it.
- A project config cannot change `memoryExtraParams.provider`. When the global config has a `provider`, OMMS keeps it for every project, even when the project file sets `memoryExtraParams`. The project keeps its other members.
- Every memory-model call sends the saved `provider` object, on every host: capture, profile learning, cleanup, tagging, chat, and **Test**. OpenCode, Pi and Claude Code read the same global config.
- A save made while the config changed on disk is refused. Reload the page and save again.

#### Remove stale routing

If a `provider` object is saved and the saved API URL is not on `openrouter.ai`, every request to the new endpoint still carries it. The card then shows `OpenRouter routing is still saved and is sent with every request to this endpoint.` and a **Remove OpenRouter routing** button.

1. Select **Remove OpenRouter routing**.
2. Confirm in the dialog.

OMMS removes the whole `provider` object, including fields that the card does not manage. It keeps the other `memoryExtraParams` members.

## Models

This section chooses the model for automatic capture and profile learning, one card for each host. Automatic capture is the summary OMMS writes after each exchange. Profile learning builds your user profile from your prompts.

Each card offers three choices:

- **Session model.** Use the model of the session you are working in. Saves `inherit` to `opencodeModel` or `piModel`.
- **Manual model.** Use one model from the host's own sign-in. Saves the provider and model, for example `piProvider: "openai-codex"` and `piModel: "gpt-5.6-luna"`. When the page can list the host's signed-in models, pick one. Otherwise type `provider/model`.
- **External API.** Use the endpoint from the External API card. Saves `external`. You can choose it only when the external API is fully set up. Until then the card lists the missing settings, for example `External API needs: memoryApiUrl`.

Each card also shows, without letting you change it:

- **Effective model.** The model the capture rule would use now.
- **External API line.** One sentence above the host cards. When the external API is set up, it says that OMMS uses its model when OpenCode or Pi has no model of its own. When it is not set up, it says that OMMS then uses the session model.
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

Moved to [Memory limits](web-ui-memory.md#memory-limits). `/settings#settings-section-memory` redirects to `/memory#memory-section-limits`. Defaults, units, host coverage and safe-save rules remain unchanged. The card now shows six rows, including `similarityThreshold`, and every row has a **Reset to default** action. The opt-in [Reranker](web-ui-memory.md#reranker) card sits below it on the same page.

## Embedding

The embedder is the model that lets OMMS find memories by meaning. Every memory in the store must use the same embedder, so after a change OMMS must process every saved memory again before search works well. The card says this in those words.

The card is locked. It shows:

- **Kind:** **Built-in model** or **OpenAI-compatible server**.
- **Server URL**, for a server.
- **Model** and **Vector size**.
- **API key:** set or not set. The page never shows the key.
- **Stored memories:** the number of memories a change re-embeds.

The lock button (a padlock icon) shows only when you open the page on the computer that runs OMMS. From another computer, the card is read-only.

### Change the embedder

1. Select the lock button to unlock the card.
2. Choose **Built-in model** or **OpenAI-compatible server**.
3. For a server, choose a **Preset**. The preset fills the **Server URL**.
4. Type the exact **Model** name that the server or Hugging Face uses.
5. For a server, choose the **API key** source with the shared [key control](#key-entry). A saved key shows as **The saved key is kept**; select **Replace the saved key** to choose another source.
6. Select **Test**.
7. Check the vector size in the result.
8. Select **Apply**.
9. Read the confirmation dialog, then confirm.

| Preset     | Server URL                     |
| ---------- | ------------------------------ |
| llama.cpp  | `http://localhost:8080/v1`     |
| Ollama     | `http://localhost:11434/v1`    |
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
- The lock button stays disabled while a re-embed runs.

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

The table lists each token with its **Name**, **Created**, **Expires**, and **Last used** time. **Last used** updates at most once a minute. To stop a token, select **Revoke** and confirm in the dialog. Scripts that use it then get `401`. An expired token also gets `401`.

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
- **Recent attempts.** One row for each attempt, with its model, **Why the reply ended** (the stop reason the model sent), **Reply parts** (the kinds of parts in the reply, such as text or a tool call), sizes, duration, and outcome.
- **Attempt retention (days).** How long OMMS keeps these records. The default is 30 days.

The retention fields, the trace switch and **Retry retention (hours)** save together with **Save retention**. A field that is not a whole number in its range shows a message next to it and keeps **Save retention** off.

The tables show host names: OpenCode, Pi, and Claude Code.

An attempt through the external API records the path `external-api`, the provider, and the model, on every host. It records them also when the call fails. Rows written by an older version are not changed, so they can show an empty model.

### Capture retry queue

When a live capture fails because the capture model cannot be reached, OMMS keeps a cleaned copy of the turn and tries it again later.

- **Retry retention (hours).** How long a waiting turn is kept. The default is 72 hours. The range is 0 to 720.
- Set it to 0 to turn the queue off. When you select **Save retention**, OMMS counts the waiting turns again, and a confirmation says how many it deletes. Nothing is saved until you confirm. The save then deletes the waiting turns at once.
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
- **Trace files** lists each day's file. **View** opens one. **Delete** asks you to confirm, then removes it.
- Turning tracing on asks you to confirm, because traces can hold conversation content.
- A project config can turn tracing off but never on. On a network-bound server without Basic Auth, the page refuses to turn tracing on.

Turn tracing on only while you debug a problem.

## Health

This section runs checks on the parts OMMS needs, and shows a pass, warning, or fail line for each.

- **Run checks.** Check the config files, the memory store, the embedding model, the web binding, the model selection, and the capture failure rate over the last 24 hours.
- **Run checks and test models.** Also send one short fixed prompt to each host's capture model.

A session model can be tested only from inside an open session. The web app cannot call an OpenCode signed-in model or a Pi session model. The **OpenCode model test** row then shows `warn` with the text `Skipped: an OpenCode signed-in model can be tested only inside OpenCode`. To test it, run a capture in OpenCode, or set the external API as the capture model.

Claude Code rows:

- **Claude Code model.** `pass` when the external API is fully set up. `fail` when it is not. The row names each missing setting in plain words, for example "The external API is missing: model, API URL, API key." The **OpenCode model** and **Pi model** rows use the same words. It never shows a key.
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

## Memory language

Use this card to choose the language that new memory summaries are written in.

- **Summary language** (`autoCaptureLanguage`) is **Automatic** or one language. Choosing a language saves it at once.
- **Automatic** detects the language of your prompt. Detection is unreliable on short text, so a Latin-script prompt under 100 characters counts as English. Pick a fixed language if your memories come out in a language you do not use.
- A save applies to the next capture. Memories that exist already keep their language.

## Appearance

Every choice here stays in this browser. It is not written to the OMMS config.

### Theme

1. Choose **System**, **Light** or **Dark**. **System** follows your operating system. The sidebar theme button switches between Light and Dark and changes the same choice.
2. Choose a light theme and a dark theme. **OMMS** is the default of each list. The other themes come from OpenChamber (MIT licence).
3. Type in **Filter themes** to narrow both lists by name.

### Date and time

- **Date format**: Automatic, day month year (`30 Oct 2026`), month day year (`Oct 30, 2026`) or year-month-day (`2026-10-30`).
- **Time format**: Automatic, 24-hour (`18:52`) or 12-hour (`6:52 PM`).

Automatic follows the page language. Each option shows today's date or the current time as an example. Every date and time in the web app follows the choice at once.

## Import and backfill

Moved and renamed to [Import chat history](web-ui-memory.md#import-chat-history). `/settings#settings-section-import` redirects to `/memory#memory-section-import`.

### Advanced options

See [Memory: Advanced options](web-ui-memory.md#advanced-options) for sources, dates, maps, batch size and re-analysis.

## Automatic import

See [Memory: Automatic import](web-ui-memory.md#automatic-import). `/settings#settings-section-auto-import` redirects to `/memory#memory-section-auto-import`.

### Pause and Resume

See [Memory: Pause and Resume](web-ui-memory.md#pause-and-resume).

## Profiles

Profile identity controls remain in Settings at `/settings#settings-section-profiles`. OMMS keeps one user profile for each git email. A repository with its own `user.email` can start a second profile. The **Profiles** card appears only when more than one active profile exists.

Choosing **All hosts** on Memory preserves those identity rules and does not merge different emails. [Profile learning](web-ui-memory.md#profile-learning) operates on prompts; choosing and merging identities stays here.

- The table lists each profile's email, its numbers of preferences, patterns, and workflows, the prompts analysed, and its last update. ✅ **in use** marks the profile OMMS uses now.
- **Use this profile** saves its email as `userEmailOverride` in the global config. Every folder then uses that profile.
- **Use this profile** and **Merge into** each ask you to confirm in a dialog.
- **Merge into** combines one profile into the profile you choose, with the same matching rules as profile learning. The source profile is turned off, not deleted, and the target gets a changelog entry.

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

- **Start web app at login** (`webServerAutoStart`, saved with **Save**) installs or removes a login item that starts the web app when you sign in. The change applies at the next OpenCode or Pi start. With Claude Code alone, run the command yourself. The power button in the sidebar restarts or stops the web app. See [Web UI: Power button](web-ui.md#power-button). To apply it now, run `om-memory-system web install` or `om-memory-system web uninstall`.
- **Login item** shows whether the item is installed, unsupported on this system, or missing a Node or Bun runtime. The item runs the launcher at `~/.omms/bin/omms-launch.mjs`, which starts the newest OMMS copy at each login.
- **Running version** is the OMMS version that serves this page. **Global command** is the version of the global install. OMMS reads it from the install's `package.json` and does not run the command. It looks for the command on the web app's `PATH`, then for the install beside the Node.js that runs the web app. A login item runs with a short `PATH`, so the second place matters. It shows `not installed globally` when neither has an install.
- When the global install is older than the running version, the section says that a newer copy runs in its place and that the global install is optional. It shows the command that updates it: `npx -p om-memory-system@latest om-memory-system web update`. The command takes the install lock, so it never runs at the same time as a web app's own update.
- When the global install is newer than the running version, the section warns you. The next OpenCode, Pi or Claude Code session start replaces the web app.
- When no global install exists, the section says that a global install is optional.

See [CLI: Global install](cli.md#global-install-optional) and [Updating and upgrading](upgrading.md#one-update-updates-every-host).

## Skill learning

The card holds the settings of [skill learning](configuration.md#skill-learning). It saves through the same safe flow as the other cards. See [How saving works](#how-saving-works).

- **Record agent turns** (`skillLearning`) switches recording on or off. While it is on, the card shows a warning. It says that OMMS stores full prompts, replies and tool calls in `skills.db` on this computer, that drafting sends recorded turns to the external API, that the file holds whatever the turns hold, and that the memory chat sends skill counts and short change summaries to the external API, never turn text. A project config can turn recording off for its project. It cannot turn it on.
- **Record past turns** appears while recording is on. It starts one grouped import of all past history with only **Skill turns** ticked. It makes no model call. A progress bar shows the **Skill turns** phase. When the run ends, the card shows the count of turns recorded.
- **Remove private text and secrets** (`skillLearningRedact`) is on by default. Turning it off needs a confirmation. While it is off, the card shows a danger notice: `<private>` text, API keys and passwords are stored as written and sent to the external API when OMMS drafts.
- **Recorded turns** and **File size** show the contents of `skills.db`.
- **Delete recorded turns** asks first. The confirmation states the number of turns. Confirming deletes all of them, and the card then shows 0 turns. Proposals and skill versions stay.

The watched folders (`skillFolders`) are on the [Skills page](web-ui.md#skills-page).

## Log

This section shows the latest records of `~/.omms/omms.log`, newest last. Each record has its time, a coloured level badge, its message and its data. The badge says `info`, `warn` or `error` in words, so colour is never the only signal.

OMMS writes each new line as `[time] LEVEL message: {data}`. For example:

```text
[2026-10-18T18:36:51.802+01:00] ERROR addMemory: error: {"error":"API embedding failed: 500"}
```

- `info` is routine activity.
- `warn` means OMMS fell back, skipped a unit, retried, or lost an optional feature and kept working.
- `error` means an operation failed.

Lines written before levels existed have no level word. The page guesses the level from the message text and shows `guessed` in the badge tooltip and in its accessible name. The guess reads only the message, never the data, so `Capture attempt: {"error":null}` reads as `info`.

Controls:

- **All**, **Warning** and **Error** choose the lowest level to show. **Warning** shows warnings and errors. **Error** shows errors only, from the last 200 error records in the part of the file the page reads.
- **Capture attempts only** shows only capture attempt records. It combines with the level chips.
- **Pause** stops the page from reading new records and freezes what is shown. **Resume** reads again at once and restarts the checks.
- **Refresh** reads the log again.
- **Copy visible records** copies the shown records, one per line.
- **Copy log path** copies the file path.

While the section is on screen and not paused, the page checks for new records every 5 seconds. It stops checking when you scroll the section out of view or switch to another browser tab. The list follows the newest record until you scroll up, and follows again when you scroll back to the bottom.

The page reads at most the last 256 KB of the file. The log holds sizes, identifiers, and codes. It never holds prompts, replies, or keys.
