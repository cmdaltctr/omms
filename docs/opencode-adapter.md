# OpenCode Adapter

`omms` ships an OpenCode plugin that runs the same shared memory engine as the
Pi extension. Both hosts read and write one store per project, so memories
captured in OpenCode are retrievable from Pi and vice versa.

The package supports both OpenCode plugin APIs: V1 (OpenCode 1.18.29 or
later) and V2 (native `plugins` list). The installed entry point
(`dist/plugin.js`) exports both, and OpenCode loads the one it understands.
The plugin id is always `omms`, whatever the npm package name.

## Installation

From npm (published package), add it to `~/.config/opencode/opencode.json`
(`%USERPROFILE%\.config\opencode\opencode.json` on Windows):

```jsonc
// OpenCode v2
{ "plugins": ["om-memory-system"] }

// OpenCode v1
{ "plugin": ["om-memory-system"] }
```

On OpenCode v2 you can instead run `opencode plugin add om-memory-system`.
Restart OpenCode after changing the configuration.

From a local checkout (development), build and pack the plugin, then install
the tarball the way OpenCode installs a published package:

```bash
bun install && bun run build && npm pack
```

`scripts/verify-nested-onnxruntime-fixture.mjs` shows the install layout that
CI checks for a packed build.

## Configuration

The plugin reads the same configuration files as the Pi extension:

1. `~/.config/omms/omms.jsonc` (global; the legacy
   `~/.config/opencode/opencode-mem.jsonc` is still read while the omms file
   does not exist)
2. `<project>/.opencode/omms.jsonc` (project overrides; the legacy
   `<project>/.opencode/opencode-mem.jsonc` is still read when no `omms.jsonc` exists)

Storage, embedding, privacy, deduplication, scopes, and thresholds are shared.
`storagePath` defaults to `~/.omms/data`, so both hosts use the same store for
the same project unless you override it.

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

Model selection follows the same rule as Pi ([Configuration: Choosing the model](configuration.md#choosing-the-model)): `opencodeProvider`/`opencodeModel` if set, otherwise the
external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`) if configured,
otherwise the session's model. The provider name must appear in
`opencode providers list`, and the model must support structured output. If
the OpenCode model fails and the external API is configured, the external API
is used instead, with a "Using fallback provider" toast.

Model calls run in short internal OpenCode sessions titled `omms capture`,
under a least-privilege `omms-structured` agent that the plugin registers.
OpenCode owns the auth, so no key is needed for a host model. These sessions
never trigger capture themselves and are never imported as history.

The web UI (`http://127.0.0.1:4747`) is started by the OpenCode plugin. When
several OpenCode windows run, the first one owns the port; the others use it.

## Lifecycle mapping

| OpenCode hook                                | omms behaviour                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin start                                 | Load shared config for the project directory, warm storage and embeddings, read connected providers, start the web UI                   |
| `config`                                     | Register the `omms-structured` agent and the `/memory-import-opencode-history` command                                                  |
| `chat.message` (V1)                          | Record the user prompt for capture and profile learning; inject recent project memories (`chatMessage.injectOn`: first or every prompt) |
| `prompt` + `context` (V2)                    | Record the prompt once OpenCode admits it; semantic retrieval injected as a delimited `<omms-retrieval>` system section                 |
| `chat.params`                                | Record the prompt's model when capture follows the session model                                                                        |
| `session.idle`                               | After 10 seconds of quiet, capture every uncaptured prompt in the session; the web-UI owner also runs profile learning and cleanup      |
| `session.compacted` (V1) / `compaction` (V2) | Restore the session's own memories after compaction                                                                                     |
| `command.execute.before` (V1) / command (V2) | Run `/memory-import-opencode-history`; see [opencode-history-import.md](opencode-history-import.md)                                     |
| `memory` tool                                | Shared add/search/profile/list/forget/help plus migrate/list-shards/export/import                                                       |

### Toasts

With `showAutoCaptureToasts`, `showUserProfileToasts` and `showErrorToasts`,
the plugin reports captured memories, profile updates, memory restored after
compaction, fallback-provider switches, and errors as OpenCode toasts. Pi
reports the same events through its footer status and notifications.

### Capture boundary

Each user prompt is one work unit: the prompt plus the assistant messages up
to the next user prompt. Assistant messages contribute visible text and tool
names with inputs; reasoning and tool outputs are excluded, and tool inputs
are truncated to 100 characters. A prompt is claimed before capture, so
repeated idle events or several windows never capture it twice. Failed
captures retry up to `autoCaptureMaxRetries` times.

### Compaction

The plugin does not replace OpenCode's compaction. After it runs, up to
`compaction.memoryLimit` memories from that session are restored. On V1 they
are added as a synthetic, no-reply message for the session's own agent; on V2
they are added to the system prompt of later turns.

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

Imported memories use `sourceType: "history-import"` plus `sourceFile` and
`importId`. Provenance is metadata only: it never changes retrieval
eligibility across hosts.

## Shared-store expectations

OpenCode and Pi can run in separate processes against the same store. Writes
go through the same shard allocation and write-lock path, and the same project
directory resolves to the same project tag from either host
(`omms_project_<hash>`; rows written by older versions under `opencode_` are
migrated automatically on first start).

## Limitations

- V1 injects recent memories rather than running a semantic search on every
  prompt; V2 and Pi search on every prompt.
- Profile learning and cleanup run only in the OpenCode process that owns the
  web UI.
- Historical session import is explicit and current-project by default; see
  [opencode-history-import.md](opencode-history-import.md).
