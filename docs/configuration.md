# Configuration

OMMS works with no configuration. This page covers the settings you may want to change. OpenCode and Pi read the same files and share one store.

## Where the settings live

Configure at `~/.config/omms/omms.jsonc`. While that file does not exist, omms still reads the legacy `~/.config/opencode/opencode-mem.jsonc` (it is never written), so existing installs keep working before you migrate settings. Per-project overrides go in `<project>/.opencode/omms.jsonc` (the legacy `.opencode/opencode-mem.jsonc` is still read when no `omms.jsonc` exists):

**Windows:** `%USERPROFILE%\.config\omms\omms.jsonc` (not AppData). Default storage resolves to `%USERPROFILE%\.omms\data` (the `~` form in the example below expands to your user home on Windows as well). A legacy `~/.opencode-mem/data` store migrates to the new path automatically on first start.

The plugin creates a full commented template at this path on first startup (only when no config exists at all). The trimmed example below shows the most common settings:

```jsonc
{
  "storagePath": "~/.omms/data",
  "userEmailOverride": "user@example.com",
  "userNameOverride": "John Doe",
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  // Optional Nomic task prefixes (search_document: / search_query:). After enabling,
  // re-index existing memories so store and query vectors stay aligned.
  // "embeddingUseTaskPrefixes": true,
  // Optional OpenAI-compatible embedding endpoint:
  // "embeddingApiUrl": "https://api.openai.com/v1",
  // "embeddingApiKey": "env://OPENAI_API_KEY",
  // "embeddingModel": "text-embedding-3-small",

  "memory": {
    "defaultScope": "project",
  },
  "webServerEnabled": true,
  "webServerPort": 4747,
  // Required when webServerHost is not 127.0.0.1/localhost:
  // "webServerHost": "0.0.0.0",
  // "webServerApiToken": "env://OMMS_WEB_TOKEN",

  "autoCaptureEnabled": true,
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

## Choosing the model

Auto-capture and profile learning run a background AI request to summarize technical work and learn your preferences. OpenCode and Pi choose that model by the same rule:

1. **Host model:** `opencodeProvider` + `opencodeModel` in OpenCode, `piProvider` + `piModel` in Pi. Set the model to `"inherit"` to follow whatever model the session uses.
2. **External API:** if no host model is set, `memoryModel` + `memoryApiUrl` + `memoryApiKey` (below).
3. **Session model:** if neither is set, the session's own model.

If the host model fails and the external API is configured, the external API is used instead. A half-configured external API (for example a model without a key) disables auto-capture and reports the missing settings instead of switching silently.

```jsonc
"opencodeProvider": "openai",
"opencodeModel": "gpt-5.6-luna",
"piProvider": "openai-codex",
"piModel": "gpt-5.6-luna",
```

Host models go through OpenCode's or Pi's own sign-in, so OpenCode or Pi owns the auth, token refresh, and provider routing, and no separate key is needed here. The OpenCode provider name must match an entry from `opencode providers list` and support structured JSON output; the Pi name must be in Pi's model list.

**Follow the session model:** `"inherit"` (or setting nothing at all) resolves to a concrete model at call time. In OpenCode, **auto-capture** records each prompt's model via the `chat.params` hook and reuses it. **Profile learning** and other structured-output paths are not tied to a single user message, so they use the most recent model in OpenCode's `model.json` recent list (preferring `opencodeProvider` when set). In Pi, `"inherit"` is the session's current model.

**External API** (step 2, and the fallback when a host model fails):

```jsonc
"memoryProvider": "openai-chat",
"memoryModel": "gpt-4o-mini",
"memoryApiUrl": "https://api.openai.com/v1",
"memoryApiKey": "sk-...",
```

**API Key Formats:**

```jsonc
"memoryApiKey": "sk-..."
"memoryApiKey": "file://~/.config/opencode/api-key.txt"
"memoryApiKey": "env://OPENAI_API_KEY"
```

Manual `memoryProvider` modes:

- `openai-chat`: OpenAI Chat Completions compatible API with tool/function calling. This can work with compatible proxies such as LiteLLM only when the selected upstream model and proxy preserve tool calls.
- `openai-responses`: OpenAI Responses API with function-call output.
- `anthropic`: Anthropic Messages API with tool use.
- `minimax`: MiniMax Anthropic Messages-compatible endpoint. Set `memoryApiUrl` to the global endpoint (`https://api.minimax.io`) or the China endpoint (`https://api.minimaxi.com`); the `/anthropic/v1/messages` path and `x-api-key` header are applied automatically. MiniMax text models such as `MiniMax-M3` support the adaptive thinking modes used by this plugin via `memoryExtraParams`.
- `orcarouter`: OpenAI-compatible model gateway with namespaced model IDs. `memoryApiUrl` and `memoryModel` are optional — they default to `https://api.orcarouter.ai/v1` and `orcarouter/auto` (a routing alias that selects a capable model per request). If you set `memoryModel`, use a namespaced ID such as `openai/gpt-5.5` or `deepseek/deepseek-v4-flash`; OrcaRouter rejects bare model names. Example:
  ```jsonc
  "memoryProvider": "orcarouter",
  "memoryApiKey": "<OrcaRouter API key>",
  ```
  [OrcaRouter](https://www.orcarouter.ai) also runs gateway-level, zero-trust security for AI agents on the same endpoint — screening every prompt/response and governing every tool call on a default-deny basis, with no application code changes.

## Embeddings

Embeddings power similarity search for memories and the user profile. Configure them in the same file (`~/.config/omms/omms.jsonc`). There is **no MLX backend** — local embeddings use `@huggingface/transformers` with ONNX, not Apple MLX.

**Local (default):** set only `embeddingModel`. On first use the model is downloaded from Hugging Face and cached under `{storagePath}/.cache` (default `~/.omms/data/.cache`).

**Remote (OpenAI-compatible):** set both `embeddingApiUrl` and `embeddingApiKey`. The plugin then calls `{embeddingApiUrl}/embeddings` with a Bearer token. `embeddingApiKey` accepts the same secret formats as `memoryApiKey` (`literal`, `env://…`, `file://…`).

| Key                   | Role                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `embeddingModel`      | Hugging Face id (local) or API model name (remote). Default: `Xenova/nomic-embed-text-v1` |
| `embeddingDimensions` | Optional override; usually omit — dimensions are looked up from a built-in map            |
| `embeddingApiUrl`     | Base URL for an OpenAI-compatible embeddings API (no trailing path beyond `/v1`)          |
| `embeddingApiKey`     | API key for that endpoint (required together with `embeddingApiUrl`)                      |

Recommended local models:

| Model                                | Dims | Notes                               |
| ------------------------------------ | ---- | ----------------------------------- |
| `Xenova/nomic-embed-text-v1`         | 768  | Default; multilingual, 8192 context |
| `Xenova/jina-embeddings-v2-base-en`  | 768  | English-only, 8192 context          |
| `Xenova/jina-embeddings-v2-small-en` | 512  | Faster, 8192 context                |
| `Xenova/all-MiniLM-L6-v2`            | 384  | Very fast, 512 context              |
| `Xenova/all-mpnet-base-v2`           | 768  | Good quality, 512 context           |

Example — remote OpenAI embeddings:

```jsonc
{
  "embeddingApiUrl": "https://api.openai.com/v1",
  "embeddingApiKey": "env://OPENAI_API_KEY",
  "embeddingModel": "text-embedding-3-small",
}
```

Changing `embeddingModel` (or dimensions) can trigger re-embedding of stored memories on next startup. Prefer picking a model once and sticking with it for a given data directory.

**Intel Mac (`darwin/x64`):** `onnxruntime-node@1.21.0` through `1.23.2` can crash OpenCode's embedded Bun `1.3.14` during process exit after successful local embeddings (`Ort::Env` teardown / SIGILL). The fix shipped in `1.24.1`, but fixed releases still lack an x64 native binding. `omms` therefore pins `onnxruntime-node@1.20.1` and loads transformers through a CJS resolve shim so OpenCode nested installs keep that binding. Transformers is resolved to an absolute path before that shim is installed so OpenCode's Bun `--compile` host does not fail with `Cannot find module '@huggingface/transformers' from ''`. After upgrading, clear OpenCode's nested plugin cache (`~/.cache/opencode/packages/om-memory-system@*`, or `opencode-mem@*` on pre-migration installs) and reinstall, or use a remote endpoint via `embeddingApiUrl` + `embeddingApiKey` (example above). This pin stays until onnxruntime publishes a post-teardown-fix darwin/x64 build.

## Memory scope

- `scope: "project"`: query only the current project. This is the default.
- `scope: "all-projects"`: query `search` / `list` across all project shards.
- `memory.defaultScope` sets the default query scope when no explicit scope is provided.

## Troubleshooting

- Auto-capture failures do not block manual `memory` tool usage.
- If auto-capture reports that a provider is not connected, confirm the provider name with `opencode providers list` and configure that provider in opencode first.
- If a proxy or custom provider returns plain text instead of structured/tool output, choose another model/provider or use one of the manual provider modes above.
- For models that reject `temperature`, add `"memoryTemperature": false` when using manual API configuration.
- **Intel Mac (darwin/x64) local embedding:** if embedding init fails or OpenCode exits with SIGILL after local memory use, clear `~/.cache/opencode/packages/om-memory-system@*` (or `opencode-mem@*` on pre-migration installs) after upgrading so the nested install picks up the pinned `onnxruntime-node@1.20.1`, or switch to a remote embedding endpoint via `embeddingApiUrl` + `embeddingApiKey`. See [Embeddings](#embeddings). MLX is not supported.
