# OpenCode Adapter

OMMS includes an OpenCode plugin. It runs the same shared memory engine as
the Pi extension. Both hosts read and write one store for each project. So
Pi can find memories that OpenCode captured, and OpenCode can find memories
that Pi captured.

- The package supports both OpenCode plugin APIs: V1 (OpenCode 1.18.29 or later) and V2 (native `plugins` list).
- The installed entry point (`dist/plugin.js`) exports both. OpenCode loads the one it understands.
- The plugin id is always `omms`, whatever the npm package name.

## Installation

From npm, add the package to `~/.config/opencode/opencode.json`
(`%USERPROFILE%\.config\opencode\opencode.json` on Windows):

```jsonc
// OpenCode v2
{ "plugins": ["om-memory-system"] }

// OpenCode v1
{ "plugin": ["om-memory-system"] }
```

On OpenCode v2 you can run `opencode plugin add om-memory-system` instead.
Restart OpenCode after you change the configuration.

From a local checkout (development):

1. Build and pack the plugin with the command below.
2. Install the tarball the same way OpenCode installs a published package.

```bash
bun install && bun run build && npm pack
```

`scripts/verify-nested-onnxruntime-fixture.mjs` shows the install layout that
CI checks for a packed build.

## Configuration

The plugin reads the same configuration files as the Pi extension:

1. `~/.config/omms/omms.jsonc` (global). If this file does not exist, the
   plugin reads the legacy `~/.config/opencode/opencode-mem.jsonc`.
2. `<project>/.opencode/omms.jsonc` (project overrides). If this file does not
   exist, the plugin reads the legacy `<project>/.opencode/opencode-mem.jsonc`.

- Storage, embedding, privacy, deduplication, scopes, and thresholds are shared.
- `storagePath` defaults to `~/.omms/data`. So both hosts use the same store for the same project, unless you change it.

OpenCode-specific options:

```jsonc
{
  // Model for automatic capture and profile learning. "inherit" follows the
  // session's model. Omit both to use the external API when it is configured,
  // otherwise the session's model.
  "opencodeProvider": "openai",
  "opencodeModel": "gpt-5.6-luna",
}
```

The plugin chooses the capture model with the same rule as Pi (see
[Configuration: Choosing the model](configuration.md#choosing-the-model)):

1. `opencodeProvider`/`opencodeModel`, if set.
2. The external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`), if configured.
3. The session's model.

- The provider name must appear in `opencode providers list`.
- The model must support structured output.
- If the OpenCode model fails and the external API is configured, the plugin uses the external API. It shows a "Using fallback provider" toast.

Model calls run in short internal OpenCode sessions titled `omms capture`:

- They use `omms-structured`, a least-privilege agent that the plugin registers.
- OpenCode owns the sign-in, so a host model needs no key.
- These sessions never start a capture and are never imported as history.

Each capture attempt writes a metadata line to the OMMS log. It can also
write a full trace. See [Configuration: Capture diagnostics](configuration.md#capture-diagnostics).

The OpenCode plugin starts the web UI (`http://127.0.0.1:4747`). When several
OpenCode windows run, the first one owns the port. The others use it.

History backfill (automatic history import) uses `opencodeBackfillModel`. See
[Configuration: Automatic history import and login web app](configuration.md#automatic-history-import-and-login-web-app).

## Lifecycle mapping

| OpenCode hook                                | omms behaviour                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin start                                 | Load shared config for the project directory, remove old capture traces, update the web login item when `webServerAutoStart` is set, warm storage and embeddings, read connected providers, register the OpenCode backfill model resolver, start automatic backfill when `autoBackfill` is on, start the web UI |
| `config`                                     | Register the `omms-structured` agent and the `/memory-import-opencode-history` command                                                                                                                                                                                                                          |
| `chat.message` (V1)                          | Record the user prompt for capture and profile learning; inject recent project memories (`chatMessage.injectOn`: first or every prompt)                                                                                                                                                                         |
| `prompt` + `context` (V2)                    | Record the prompt once OpenCode admits it; semantic retrieval injected as a delimited `<omms-retrieval>` system section                                                                                                                                                                                         |
| `chat.params`                                | Record the prompt's model when capture follows the session model                                                                                                                                                                                                                                                |
| `session.idle`                               | After 10 seconds of quiet, capture every uncaptured prompt in the session; the web-UI owner also runs profile learning and cleanup                                                                                                                                                                              |
| `session.compacted` (V1) / `compaction` (V2) | Restore the session's own memories after compaction                                                                                                                                                                                                                                                             |
| `command.execute.before` (V1) / command (V2) | Run `/memory-import-opencode-history`; see [opencode-history-import.md](opencode-history-import.md)                                                                                                                                                                                                             |
| `memory` tool                                | Shared add/search/profile/list/forget/help plus migrate/list-shards/export/import                                                                                                                                                                                                                               |

### Toasts

With `showAutoCaptureToasts`, `showUserProfileToasts` and `showErrorToasts`,
the plugin shows OpenCode toasts for:

- captured memories and profile updates
- memories restored after compaction
- changes to the fallback provider
- errors

Pi reports the same events through its footer status and notifications.

### Capture boundary

Each user prompt is one work unit: the prompt plus the assistant messages up
to the next user prompt.

- From assistant messages, capture takes visible text, and tool names with their inputs.
- It leaves out reasoning and tool outputs. It cuts tool inputs to 100 characters.
- The plugin claims a prompt before capture. So repeated idle events or several windows never capture it twice.
- A failed capture tries again up to `autoCaptureMaxRetries` times.

### Compaction

The plugin does not replace OpenCode's compaction. After compaction, it
restores up to `compaction.memoryLimit` memories from that session:

- On V1, it adds them as a synthetic, no-reply message for the session's own agent.
- On V2, it adds them to the system prompt of later turns.

## Provenance

Memories captured from OpenCode carry:

```json
{
  "host": "opencode",
  "hostSessionId": "<opencode session id>",
  "sourceType": "live-capture",
  "promptId": "<user message id>",
  "sourceEntryIds": ["<assistant message ids>"],
  "sourceTimestamp": 1767225600000
}
```

Imported memories use `sourceType: "history-import"`, plus `sourceFile` and
`importId`. Provenance is only metadata. It never changes which memories
either host can retrieve.

## Shared-store expectations

OpenCode and Pi can run in separate processes against the same store.

- Writes go through the same shard allocation and write-lock path.
- The same project folder resolves to the same project tag from either host (`omms_project_<hash>`).
- Rows that older versions wrote under `opencode_` are migrated automatically on first start.

## Limitations

- V1 adds recent memories. It does not run a semantic search for each prompt. V2 and Pi search for each prompt.
- Profile learning and cleanup run only in the OpenCode process that owns the web UI.
- Manual history import covers the current project by default. See [opencode-history-import.md](opencode-history-import.md).
