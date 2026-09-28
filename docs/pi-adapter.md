# Pi Adapter

OMMS includes a Pi coding-agent extension. It runs the same shared memory
engine as the OpenCode plugin. Both hosts read and write one store for each
project. So Pi can find memories that OpenCode captured, and OpenCode can find
memories that Pi captured.

The extension is tested against `@earendil-works/pi-coding-agent` **0.86.1**.
When you upgrade the Pi dependency, check the lifecycle APIs again. They are
listed in `openspec/changes/archive/2026-09-21-add-pi-adapter-shared-memory/design.md`.

## Installation

From npm:

```bash
pi install npm:om-memory-system
```

From a local checkout (development):

```bash
# build first: the Pi manifest points at compiled output
bun install && bun run build
pi install /absolute/path/to/omms
```

Or try it without installing:

```bash
pi -e /absolute/path/to/omms
```

- Pi finds the extension through the `pi` manifest in `package.json` (`dist/adapters/pi/extension.js`).
- The Pi core packages (`@earendil-works/pi-coding-agent`, `typebox`) are peer dependencies.
- The Pi runtime on the host provides them. The package does not include a second runtime.

## Configuration

The extension reads the same configuration files as the OpenCode plugin:

1. `~/.config/omms/omms.jsonc` (global). If this file does not exist, the
   extension reads the legacy `~/.config/opencode/opencode-mem.jsonc`.
2. `<project>/.opencode/omms.jsonc` (project overrides). If this file does not
   exist, the extension reads the legacy `<project>/.opencode/opencode-mem.jsonc`.

- Storage, embedding, privacy, deduplication, scopes, and thresholds are shared.
- `storagePath` defaults to `~/.omms/data`. So both hosts use the same store for the same project, unless you change it.
- On first start, a legacy `~/.opencode-mem/data` store moves there automatically, after a verified backup. See [omms-migration.md](omms-migration.md).

Pi-specific options:

```jsonc
{
  // Model for automatic capture and profile learning. "inherit" follows the
  // session's model. Omit both to use the external API when it is configured,
  // otherwise the session's model.
  "piProvider": "openai-codex",
  "piModel": "gpt-5.6-luna",
}
```

The extension chooses the capture model with the same rule as OpenCode (see
[Configuration: Choosing the model](configuration.md#choosing-the-model)):

1. `piProvider`/`piModel`, if set.
2. The external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`), if configured.
3. The session's model (`ctx.model`).

- If the Pi model fails or is not in Pi's model list, and the external API is configured, the extension uses the external API.
- If no model resolves, automatic capture fails and writes a log entry. Manual memory operations stay available.

Each capture attempt writes a metadata line to the OMMS log. It can also
write a full trace. See [Configuration: Capture diagnostics](configuration.md#capture-diagnostics).

The Pi adapter does not start the web server itself. When both hosts run, let
OpenCode own the web server port. When `webServerAutoStart` is set, the Pi
adapter updates the web app login item, the same as OpenCode.

History backfill (automatic history import) uses `piBackfillModel`. See
[Configuration: Automatic history import and login web app](configuration.md#automatic-history-import-and-login-web-app).

## Lifecycle mapping

| Pi event                    | omms behaviour                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_start`             | Load shared config for `ctx.cwd`, remove old capture traces, update the web login item when `webServerAutoStart` is set, register the Pi backfill model resolver, start automatic backfill when `autoBackfill` is on, warm storage and embeddings in the background |
| `before_agent_start`        | Semantic retrieval: search project memory with the incoming prompt, inject results as a delimited `<omms-retrieval>` system-prompt section (never a fake user message)                                                                                              |
| `agent_settled`             | Automatic capture of the settled work unit: the last user prompt plus its assistant/tool response window from the active branch                                                                                                                                     |
| `session_shutdown`          | Cleanup that is safe to repeat (quit, reload, new, resume, fork). Stops a running automatic backfill and closes the store                                                                                                                                           |
| `/memory-import-pi-history` | Import Pi session history; see [pi-history-import.md](pi-history-import.md)                                                                                                                                                                                         |
| `memory` tool               | Shared add/search/profile/list/forget/help plus migrate/list-shards/export/import                                                                                                                                                                                   |

### Footer status

The Pi adapter shows its current state in Pi's footer:

- `omms:warming` while storage and embeddings start
- `omms:connected` when OMMS is ready
- `omms:recalling` while relevant memories are retrieved
- `omms:capturing` while settled work is processed
- `omms:error` when an OMMS operation fails

The adapter clears the status when the Pi session shuts down.

### Capture boundary

Capture runs only at `agent_settled`, after automatic retries, compaction,
and queued continuation finish. The adapter does not use `agent_end`, on
purpose.

- A failed capture tries again up to `autoCaptureMaxRetries` times (default 3), 2 and 4 seconds apart, the same as OpenCode. If the last try fails because the model cannot be reached, the turn goes to the [capture retry queue](configuration.md#capture-retry-queue).
- The Pi user-entry ID identifies the work unit. So retries, compaction continuation, and repeated settled events never capture it twice.
- From assistant entries, capture takes only visible text and tool-call inputs.
- It leaves out hidden thinking blocks and tool results. It cuts tool inputs to 100 characters.

### Compaction

The adapter does not replace or change Pi's native compaction. If compaction
happens during a run, capture waits for the settled point. The work unit then
covers both sides of the compaction, and each part is captured once.

## Provenance

Memories captured from Pi carry:

```json
{
  "host": "pi",
  "hostSessionId": "<pi session id>",
  "sourceType": "live-capture",
  "promptId": "<user entry id>",
  "sourceEntryIds": ["<assistant entry ids>"],
  "sourceTimestamp": 1767225600000
}
```

Provenance is only metadata. It never changes which memories either host can
retrieve.

## Shared-store expectations

OpenCode and Pi can run in separate processes against the same store.

- Writes go through the same shard allocation and write-lock path as OpenCode.
- The same project folder resolves to the same project tag from either host (`omms_project_<hash>`).
- Rows that older versions wrote under `opencode_` are migrated automatically on first start.

## Limitations

- Pi profile learning applies analysed batches directly. It does not have the decay, validation-task, and conflict-retry steps of the OpenCode idle path.
- Manual history import covers the current project by default. See [pi-history-import.md](pi-history-import.md).
