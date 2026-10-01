# Configuration

OMMS works with no configuration. This page covers the settings you may want to change. OpenCode, Pi, and Claude Code read the same files and share one store.

## Where the settings live

- **Global file:** `~/.config/omms/omms.jsonc`. On Windows this is `%USERPROFILE%\.config\omms\omms.jsonc`, not AppData.
- **Legacy global file:** while the global file does not exist, OMMS still reads `~/.config/opencode/opencode-mem.jsonc`. It never writes to it.
- **Project file:** `<project>/.opencode/omms.jsonc` overrides the global file for that project. OMMS still reads a legacy `.opencode/opencode-mem.jsonc` when no `omms.jsonc` exists. Some settings are [global only](#global-only-settings).
- **Default store:** `~/.omms/data` (`%USERPROFILE%\.omms\data` on Windows). A legacy `~/.opencode-mem/data` store moves to the new path at first start.

On first start, if no config exists at all, the plugin creates a full commented template. This shorter example shows the most common settings:

```jsonc
{
  "storagePath": "~/.omms/data",
  "userEmailOverride": "user@example.com",
  "userNameOverride": "John Doe",
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  // Optional Nomic task prefixes (search_document: / search_query:). After enabling,
  // re-index existing memories so store and query vectors stay aligned.
  // "embeddingUseTaskPrefixes": true,
  // Optional OpenAI-compatible embedding endpoint (the key is optional):
  // "embeddingApiUrl": "https://api.openai.com/v1",
  // "embeddingApiKey": "env://OPENAI_API_KEY",
  // "embeddingModel": "text-embedding-3-small",

  "memory": {
    "defaultScope": "project",
  },
  "webServerEnabled": true,
  "webServerAutoStart": true,
  "webServerPort": 4747,
  // Reach the web app from your network. Needs an API token or a browser password:
  // "webServerHost": "0.0.0.0",

  "autoCaptureEnabled": true,
  "autoBackfill": true,
  "piBackfillModel": "inherit", // or "external", or "provider/model"
  "opencodeBackfillModel": "inherit", // or "external", or "provider/model"
  "importPathMaps": [{ "from": "~/code/app-feat-x", "to": "~/code/app" }],
  "claudeConfigDir": "",
  "autoCaptureLanguage": "auto",

  // Model for auto-capture and profile learning (see "Choosing the model").
  // Omit all of these to use the session's own model.
  "opencodeProvider": "anthropic",
  "opencodeModel": "claude-haiku-4-5-20251001", // or "inherit"
  // "piProvider": "openai-codex",
  // "piModel": "gpt-5.6-luna",

  // External API, used when no host model is set or when it fails:
  // "memoryProvider": "openai-chat",
  // "memoryModel": "gpt-4o-mini",
  // "memoryApiUrl": "https://api.openai.com/v1",
  // "memoryApiKey": "env://OPENAI_API_KEY",

  "showAutoCaptureToasts": true,
  "showUserProfileToasts": true,
  "showErrorToasts": true,

  "userProfileAnalysisInterval": 10,
  "userProfileMaxContextBytes": 32768,
  "maxMemories": 10,

  "compaction": {
    "enabled": true,
    "memoryLimit": 10,
  },
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": undefined,
    "injectOn": "first", // OpenCode v1 only; v2 and Pi search on every prompt
  },
}
```

## Settings in the web UI

Open the Settings page in the login web app, in OpenCode, or with `om-memory-system web`. [Web UI settings](web-ui-settings.md) explains each part of the page.

- The page writes only to the global file. It does not edit a project's config.
- It can change `opencodeProvider`, `opencodeModel`, `piProvider`, `piModel`, `autoBackfill`, `opencodeBackfillModel`, `piBackfillModel`, `importPathMaps`, `claudeConfigDir`, `webServerAutoStart`, `captureTrace`, `captureTraceRetentionDays`, `captureAttemptRetentionDays`, `captureRetryRetentionHours`, `memoryProvider`, `memoryApiUrl`, `memoryModel`, and `memoryApiKey`.
- The general save changes only one credential, `memoryApiKey`. It accepts only an `env://` or `file://` reference and rejects a literal key.
- The **Embedding** card changes `embeddingApiUrl`, `embeddingModel`, `embeddingDimensions`, and `embeddingApiKey` together, after a passing test. The general save refuses these keys.
- The **Keys and access** card sets or clears the browser password. It writes `webServerAuthPassword` as a `file://` reference and `webServerAuthUsername`. The general save refuses these keys.
- If you paste a key, the page saves it to a key file in `~/.config/omms/secrets/` and stores a `file://` reference to it. The folder and file are readable only by you.
- `captureAttemptRetentionDays` defaults to 30. Both retention fields need at least 1 day.
- `captureRetryRetentionHours` defaults to 72. It accepts whole hours from 0 to 720. 0 turns the capture retry queue off, and saving 0 deletes the waiting turns at once.
- Choosing **Session model** writes `inherit` to the host's model key. That choice takes priority over a configured external API.
- Choosing a manual model writes the selected host provider and model.
- OpenCode, Pi, and the web app that serves Claude Code reload changed config files at the next capture or profile-learning run. You do not need to restart.
- On a legacy-only install, the first save copies the old config and its comments to `~/.config/omms/omms.jsonc`. OMMS reads the new file from then on. The old file stays unchanged.
- The page rejects a save if the file changed since the page loaded it. Check the refreshed values, then save again.

## Automatic history import and login web app

`autoBackfill` defaults to `true`. About 30 seconds after Pi or OpenCode starts, that host imports its own past chats in the background. For Claude Code, the web app runs the backfill after the first Claude Code session start that reaches it. See [Claude Code history import](claude-code-history-import.md#automatic-import).

- It covers projects whose directories resolve, and it records profile prompts.
- It resumes from the ledger after a restart.
- At the first run for each host, it saves a fixed cutoff. It only imports turns that existed then. Live capture handles newer turns.
- It skips exchanges that live capture already saved.
- Unresolved directories appear in the progress counts and in the Settings page's **Directory maps** list. To include them, save a map there or add it to `importPathMaps`.
- Backfill makes model calls. To avoid them, set `"autoBackfill": false` before you upgrade. If you turn it off during a run, the run stops after the current exchange.

`importPathMaps` is a list of `{ "from": ..., "to": ... }` directory maps.

- `~` is expanded. After that, both paths must be absolute. A bad entry is a config error.
- Automatic backfill, web imports, CLI imports, and slash-command imports all use it.
- A run's own `--map` adds to the list and wins for the same `from`.
- If the `to` directory does not exist, its sessions stay unresolved.

On the Settings page you can **Run now**, **Pause**, and **Resume** each host's backfill.

- A paused backfill does not start when the host starts. It waits until you resume it.
- Every real import records its progress in `import-ledger.db`. It stores numbers only, no conversation content.
- One import per host runs at a time, across the backfill, the page, the slash commands, and the CLI.

`piBackfillModel` and `opencodeBackfillModel` choose the backfill model. They default to `"inherit"`.

- `"inherit"` on Pi follows Pi's live-capture model rule.
- `"inherit"` on OpenCode uses the configured host model, then the saved external API, then OpenCode's configured default model.
- `"external"` sends that host's backfill to the external API. If the external API is not fully configured, the backfill stops and names the missing setting. With `"external"`, Run now also works in the login web app with no host open.
- A signed-in `provider/model` chooses another backfill model without changing live capture.
- Any other value is a config error.
- If no model is available, the backfill stops and records an error.
- Claude Code has no backfill model setting. Its backfill always uses the external API. There is no `claudeBackfillModel` key.

`webServerAutoStart` defaults to `true`. When `webServerEnabled` is also true, OMMS registers a per-user login item for the web app.

- On macOS it is a LaunchAgent. On Linux it is a systemd user unit. On Windows it is a Startup-folder entry.
- Each host start checks the item. If you turn either setting off, the next host start removes it.
- To apply a change at once, run `om-memory-system web install` or `om-memory-system web uninstall`.
- The item needs Node or Bun. It uses the same port and authentication settings as the OpenCode-hosted web app.

`autoBackfill` and `webServerAutoStart` must be `true` or `false`.

## Claude Code folder

`claudeConfigDir` is the folder Claude Code keeps its data in. OMMS reads Claude Code transcripts from `<folder>/projects`.

- Leave it empty (the default) to use `CLAUDE_CONFIG_DIR`, then `~/.claude`.
- Set it when you start Claude Code with `CLAUDE_CONFIG_DIR`. The web app often does not have that variable, for example when a login item starts it.
- The value must be an absolute path or start with `~/`. Any other value is a config error.
- Live capture, history import, and automatic backfill all use it. A CLI `--root` still overrides it for one import.
- Set it on the Settings page, in the **Claude Code folder** section. The page shows the folder in use and where it comes from.

## Web app access

- `webServerHost` defaults to `127.0.0.1`. A non-loopback host needs an unexpired API token or a browser password, or the web app refuses to start.
- Manage API tokens on the Settings page. OMMS keeps them in `~/.omms/api-tokens.json`. See [Web UI: Network access](web-ui.md#network-access).
- `webServerApiToken` is no longer read. At the first web app start after the upgrade, OMMS imports its value once as the API token `from config file`, with no expiry. OMMS does not change the config file. Later changes to the key have no effect. See [Upgrading: API tokens](upgrading.md#api-tokens-replace-webserverapitoken).
- `webServerAuthPassword` and `webServerAuthUsername` turn on HTTP Basic Auth. See [Web UI: HTTP Basic Auth](web-ui.md#http-basic-auth).

## Global-only settings

Some settings are read only from the global file.

- OMMS ignores these in a project's `.opencode/omms.jsonc`: `autoBackfill`, `piBackfillModel`, `opencodeBackfillModel`, `importPathMaps`, `claudeConfigDir`, `webServerAutoStart`, `webServerEnabled`, `captureTraceRetentionDays`, `captureRetryRetentionHours`, `autoCleanupEnabled`, and `autoCleanupRetentionDays`. This stops one project from, for example, turning off the shared web server for another.
- A project config cannot turn `captureTrace` on. See [Capture traces](#capture-traces-opt-in).
- A project config that sets `embeddingApiUrl`, `embeddingApiKey`, `memoryProvider`, `memoryApiUrl`, or `memoryApiKey` is an error. Move those to the global file.

See [Web UI settings](web-ui-settings.md) for backfill status and [CLI](cli.md#web-app-commands) for the login-item commands.

## Choosing the model

Auto-capture and profile learning send a background AI request. It summarises technical work and learns your preferences. OpenCode and Pi choose the model by the same rule:

1. **Host model:** `opencodeProvider` and `opencodeModel` in OpenCode, `piProvider` and `piModel` in Pi.
   - Set the model to `"inherit"` to follow the session's model.
   - Set it to `"external"` to send every call to the external API. The provider value is then ignored.
2. **External API:** if no host model is set, `memoryModel`, `memoryApiUrl`, and `memoryApiKey` (below).
3. **Session model:** if neither is set, the session's own model.

Claude Code uses step 2 only. Its hooks cannot call the Claude Code session's
model, so there is no Claude Code host model setting and no session model path.

- Set `memoryModel`, `memoryApiUrl`, and `memoryApiKey` to turn on Claude Code capture and profile learning.
- When the external API is not fully configured, Claude Code capture and profile learning are off. The web app logs the missing settings once, and the Settings page shows them.
- Retrieval and the `om-memory-system memory` command work without the external API.

See [Claude Code adapter](claude-code-adapter.md#the-external-api-is-required).

How failures are handled:

- If the host model fails and the external API is configured, OMMS uses the external API instead.
- With `"external"`, the external API is already the main call. A failure is not retried elsewhere.
- With `"external"` and an incomplete external API, auto-capture is off on that host. OMMS reports the missing settings.
- A half-configured external API (for example, a model without a key) also turns auto-capture off and reports the missing settings. OMMS does not switch models silently.

```jsonc
"opencodeProvider": "openai",
"opencodeModel": "gpt-5.6-luna",
"piProvider": "openai-codex",
"piModel": "gpt-5.6-luna",
```

Host models use OpenCode's or Pi's own sign-in. The host handles the login, token refresh, and provider routing, so you need no separate key here.

- The OpenCode provider name must match an entry from `opencode providers list`. The model must support structured JSON output.
- The Pi name must be in Pi's model list.

**Follow the session model:** `"inherit"`, or no setting at all, picks a concrete model at call time.

- In OpenCode, **auto-capture** records each prompt's model through the `chat.params` hook and uses it again.
- In OpenCode, **profile learning** and other structured-output paths are not tied to one user message. They use the most recent model in OpenCode's `model.json` recent list. They prefer `opencodeProvider` when it is set.
- In Pi, `"inherit"` is the session's current model.

**External API** (step 2, and the fallback when a host model fails):

```jsonc
"memoryProvider": "openai-chat",
"memoryModel": "gpt-4o-mini",
"memoryApiUrl": "https://api.openai.com/v1",
"memoryApiKey": "sk-...",
```

**API key formats:**

```jsonc
"memoryApiKey": "sk-..."
"memoryApiKey": "file://~/.config/omms/secrets/memory-api.key"
"memoryApiKey": "env://OPENAI_API_KEY"
```

- A login web app started by the login item does not load your shell profile. An `env://` variable set only there does not resolve in it. The Settings page's External API card reports this.
- A `file://` key file works in every OMMS process.
- If an `env://` or `file://` key does not resolve, OMMS treats `memoryApiKey` as not set. It still loads the rest of the config.

`memoryProvider` modes:

- `openai-chat`: an OpenAI Chat Completions compatible API with tool (function) calling. It can work with compatible proxies such as LiteLLM, but only when the upstream model and the proxy keep tool calls.
- `openai-responses`: the OpenAI Responses API with function-call output.
- `anthropic`: the Anthropic Messages API with tool use.
- `google-gemini`: the Google Gemini API.
- `minimax`: a MiniMax endpoint compatible with Anthropic Messages.
  - Set `memoryApiUrl` to the global endpoint (`https://api.minimax.io`) or the China endpoint (`https://api.minimaxi.com`).
  - OMMS adds the `/anthropic/v1/messages` path and the `x-api-key` header.
  - MiniMax text models such as `MiniMax-M3` support the adaptive thinking modes this plugin uses through `memoryExtraParams`.
- `orcarouter`: an OpenAI-compatible model gateway with namespaced model IDs.
  - `memoryApiUrl` and `memoryModel` are optional. They default to `https://api.orcarouter.ai/v1` and `orcarouter/auto`. `orcarouter/auto` is a routing alias that picks a capable model for each request.
  - If you set `memoryModel`, use a namespaced ID such as `openai/gpt-5.5` or `deepseek/deepseek-v4-flash`. OrcaRouter rejects bare model names.
  - Only `memoryApiKey` is required:
    ```jsonc
    "memoryProvider": "orcarouter",
    "memoryApiKey": "<OrcaRouter API key>",
    ```
  - [OrcaRouter](https://www.orcarouter.ai) also runs gateway-level security for AI agents on the same endpoint. It screens every prompt and response and controls every tool call on a default-deny basis. You do not need to change application code.

## Embeddings

Embeddings power similarity search for memories and the user profile. Set them in the same global file.

- There is **no MLX backend**. Local embeddings use `@huggingface/transformers` with ONNX, not Apple MLX.
- **Local (default):** set only `embeddingModel`. On first use, OMMS downloads the model from Hugging Face and caches it under `{storagePath}/.cache` (default `~/.omms/data/.cache`).
- **Remote (OpenAI-compatible):** set `embeddingApiUrl`. OMMS then calls `{embeddingApiUrl}/embeddings`. `embeddingApiKey` is optional. OMMS sends it as a Bearer token only when it is set. A server on your computer, such as Ollama or llama.cpp, needs no key. `embeddingApiKey` accepts the same formats as `memoryApiKey`: a literal key, `env://…`, or `file://…`.

| Key                   | Role                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `embeddingModel`      | Hugging Face id (local) or API model name (remote). Default: `Xenova/nomic-embed-text-v1` |
| `embeddingDimensions` | Optional override. Usually leave it out; OMMS looks up dimensions in a built-in map       |
| `embeddingApiUrl`     | Base URL for an OpenAI-compatible embeddings API (no trailing path beyond `/v1`)          |
| `embeddingApiKey`     | Optional API key for that endpoint. Sent only when set                                    |

Recommended local models:

| Model                                | Dims | Notes                               |
| ------------------------------------ | ---- | ----------------------------------- |
| `Xenova/nomic-embed-text-v1`         | 768  | Default; multilingual, 8192 context |
| `Xenova/jina-embeddings-v2-base-en`  | 768  | English-only, 8192 context          |
| `Xenova/jina-embeddings-v2-small-en` | 512  | Faster, 8192 context                |
| `Xenova/all-MiniLM-L6-v2`            | 384  | Very fast, 512 context              |
| `Xenova/all-mpnet-base-v2`           | 768  | Good quality, 512 context           |

Example of remote OpenAI embeddings:

```jsonc
{
  "embeddingApiUrl": "https://api.openai.com/v1",
  "embeddingApiKey": "env://OPENAI_API_KEY",
  "embeddingModel": "text-embedding-3-small",
}
```

Change the embedder on the Settings page, in the **Embedding** card. The card tests the new values, writes the four embedding keys in one save, and re-embeds every memory. See [Settings page: Embedding](web-ui-settings.md#embedding). The general settings save refuses these keys.

If you change `embeddingModel` or the dimensions by hand, open the web UI and run the re-embed. OMMS flags a store file for a re-embed when its vector size or its stored model name differs from the configured embedder. A store file with no stored model name, from an older version, is flagged only on size. Choose one model for each data directory and keep it.

**Intel Mac (`darwin/x64`):** `onnxruntime-node@1.21.0` to `1.23.2` can crash OpenCode's embedded Bun `1.3.14` when the process exits after local embeddings (`Ort::Env` teardown, SIGILL).

- The fix shipped in `1.24.1`, but fixed releases still have no x64 native binding.
- So `omms` pins `onnxruntime-node@1.20.1`. It loads transformers through a CJS resolve shim, so OpenCode nested installs keep that binding.
- OMMS resolves transformers to an absolute path before it installs that shim. This stops OpenCode's Bun `--compile` host failing with `Cannot find module '@huggingface/transformers' from ''`.
- After you upgrade, clear OpenCode's nested plugin cache (`~/.cache/opencode/packages/om-memory-system@*`, or `opencode-mem@*` on installs before the migration) and reinstall. Or use a remote endpoint through `embeddingApiUrl`, with `embeddingApiKey` when the server needs one (example above).
- The pin stays until onnxruntime publishes a darwin/x64 build with the teardown fix.

## Memory scope

- `scope: "project"`: query only the current project. This is the default.
- `scope: "all-projects"`: query `search` / `list` across all project shards.
- `memory.defaultScope` sets the default query scope when no explicit scope is provided.

## Capture diagnostics

Every capture attempt, on Pi, OpenCode, and Claude Code, for live capture and history
imports, writes one `Capture attempt` line to `~/.omms/omms.log`. The line
holds metadata only: host, source (`live-capture` or `history-import`),
session ID, extraction path (`host-model` or `external-api`), provider, model,
the model's stop reason, the reply's content block types, prompt and reply
sizes in characters, duration, and the outcome. It never holds prompt or reply
text. A field the path cannot observe is `null`; for example, OpenCode's own
model reports no block types for some server versions.

The outcome is `saved`, `skipped`, or `failed`. A failed attempt carries one
reason code:

| Reason            | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `call-error`      | The model call failed or threw before a reply was available.            |
| `empty-text`      | The reply had no text, for example only reasoning blocks.               |
| `truncated`       | The model stopped at its output length limit and the JSON is cut off.   |
| `invalid-json`    | The reply had text, but no JSON object could be read from it.           |
| `schema-mismatch` | The JSON is not a valid capture summary (for example an empty summary). |
| `persist-error`   | The summary was valid, but the memory could not be stored.              |

To count failures by reason:

```bash
grep '"Capture attempt' ~/.omms/omms.log | grep -o '"reason":"[a-z-]*"' | sort | uniq -c
```

### Capture traces (opt-in)

To see the full prompt and raw reply of each attempt, turn on tracing in the
**global** config:

```jsonc
{
  "captureTrace": true,
  "captureTraceRetentionDays": 7, // default 7, minimum 1
}
```

Each attempt then appends one JSON line to
`~/.omms/traces/capture-YYYY-MM-DD.jsonl` (next to the log file, so
`OMMS_LOG_FILE` moves it too). A trace entry has every field of the log line
plus `systemPrompt`, `userPrompt`, and `reply`.

**Traces can contain conversation content.** Before writing, OMMS replaces
text inside `<private>` tags, your configured API keys and tokens, and common
key formats (`sk-…`, `ghp_…`, `AKIA…`, JWTs, `Bearer` tokens, private key
blocks) with `[REDACTED]`. Pattern matching cannot catch every secret, so the
directory and files are readable only by you, and files older than
`captureTraceRetentionDays` are deleted each day and at every start, even
after you turn tracing off. Delete `~/.omms/traces/` at any time.

A project config (`.opencode/omms.jsonc`) can set `"captureTrace": false` to
stop tracing in that project. It cannot turn tracing on: a project value of
`true` is ignored and logged, so a cloned repository cannot start recording
your conversations. `captureTraceRetentionDays` is global only.

### Capture retry queue

When a live capture fails because the capture model cannot be reached, OMMS
keeps a copy of the turn and tries it again later. It queues a turn only for a
network failure, a timeout, or HTTP 408, 429 or 5xx. It does not queue a bad
key, a bad request or a bad model reply.

```jsonc
{
  "captureRetryRetentionHours": 72, // default 72, whole hours from 0 to 720
}
```

- The queue is in `~/.omms/data/user-prompts.db`, never in a project folder.
- OMMS removes `<private>` text and redacts secrets with the trace rules before
  it stores a turn. A turn over 256 KB is not queued. The queue holds at most
  20 MB.
- A turn is deleted when its retry saves a memory, when the retry skips it, when
  the retry fails for good, or after `captureRetryRetentionHours`.
- `0` turns the queue off. OMMS queues nothing, retries nothing, and deletes
  the waiting turns.
- `captureRetryRetentionHours` is global only. A project value is ignored.
- Running hosts use a changed value from their next retry pass or cleanup run.

## Troubleshooting

- Auto-capture failures do not block manual `memory` tool usage.
- If Claude Code captures nothing, look for `Claude Code capture is off` in `~/.omms/omms.log`. It names the missing external API settings. See [Claude Code adapter: Troubleshooting](claude-code-adapter.md#troubleshooting).
- To find out why captures fail, read the `reason` in the `Capture attempt` log lines, or turn on a capture trace. See [Capture diagnostics](#capture-diagnostics).
- If auto-capture reports that a provider is not connected, confirm the provider name with `opencode providers list` and configure that provider in opencode first.
- If a proxy or custom provider returns plain text instead of structured/tool output, choose another model/provider or use one of the manual provider modes above.
- For models that reject `temperature`, add `"memoryTemperature": false` when using manual API configuration.
- **Intel Mac (darwin/x64) local embedding:** if embedding init fails or OpenCode exits with SIGILL after local memory use, clear `~/.cache/opencode/packages/om-memory-system@*` (or `opencode-mem@*` on pre-migration installs) after upgrading so the nested install picks up the pinned `onnxruntime-node@1.20.1`, or switch to a remote embedding endpoint via `embeddingApiUrl` + `embeddingApiKey`. See [Embeddings](#embeddings). MLX is not supported.
