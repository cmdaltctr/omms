# Pi Adapter

`omms` ships a Pi coding-agent extension that runs the same shared
memory engine as the OpenCode plugin. Both hosts read and write one store per
project, so memories captured in OpenCode are retrievable from Pi and vice
versa.

Verified against `@earendil-works/pi-coding-agent` **0.86.1**. Re-verify the
lifecycle APIs in `openspec/changes/add-pi-adapter-shared-memory/design.md`
when upgrading the Pi dependency.

## Installation

From npm (published package):

```bash
pi install npm:omms
```

From a local checkout (development):

```bash
# build first: the Pi manifest points at compiled output
bun install && bun run build
pi install /absolute/path/to/opencode-mem
```

Or try it without installing:

```bash
pi -e /absolute/path/to/opencode-mem
```

Pi discovers the extension through the `pi` manifest in `package.json`
(`dist/adapters/pi/extension.js`). Pi core packages
(`@earendil-works/pi-coding-agent`, `typebox`) are peer dependencies: the host
Pi runtime provides them and no second runtime is bundled.

## Configuration

The extension reads the same configuration files as the OpenCode plugin:

1. `~/.config/omms/omms.jsonc` (global; the legacy
   `~/.config/opencode/opencode-mem.jsonc` is still read while the omms file
   does not exist)
2. `<project>/.opencode/opencode-mem.jsonc` (project overrides)

Storage, embedding, privacy, deduplication, scopes, and thresholds are shared.
`storagePath` defaults to `~/.omms/data` — a legacy `~/.opencode-mem/data`
store is migrated there automatically on first start with a verified backup
first (see [omms-migration.md](omms-migration.md)) — so both hosts use the
same store for the same project unless you override it.

Pi-specific options:

```jsonc
{
  // Extraction model for automatic capture. Omit to inherit the active
  // Pi model (recommended).
  "piProvider": "anthropic",
  "piModel": "claude-sonnet-4-5",
}
```

Model selection order: explicit `piProvider`/`piModel` if set, otherwise the
active Pi model (`ctx.model`). If no model resolves, automatic capture is
skipped with a log entry; manual memory operations remain available.

The web UI is not started by the Pi adapter. When both hosts run, let OpenCode
own the web server port as before.

## Lifecycle mapping

| Pi event             | omms behaviour                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_start`      | Load shared config for `ctx.cwd`, warm storage and embeddings in the background                                                                                                |
| `before_agent_start` | Semantic retrieval: search project memory with the incoming prompt, inject results as a delimited `<opencode-mem-retrieval>` system-prompt section (never a fake user message) |
| `agent_settled`      | Automatic capture of the settled work unit: the last user prompt plus its assistant/tool response window from the active branch                                                |
| `session_shutdown`   | Idempotent cleanup (quit, reload, new, resume, fork)                                                                                                                           |
| `memory` tool        | Shared add/search/profile/list/forget/help plus migrate/list-shards/export/import                                                                                              |

### Capture boundary

Capture runs only at `agent_settled`, after automatic retries, compaction, and
queued continuation finish. `agent_end` is deliberately not used. The work unit
is identified by the Pi user-entry ID: retries, compaction continuation, and
repeated settled events never capture the same unit twice. Assistant entries
contribute visible text and tool-call inputs only; hidden thinking blocks and
tool results are excluded, and tool inputs are truncated to 100 characters.

### Compaction

The adapter does not replace or customise Pi's native compaction. When
compaction occurs mid-run, capture waits for the settled boundary and the work
unit spans the compaction (assistant work on both sides is captured once).

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

Provenance is metadata only: it never changes retrieval eligibility across
hosts.

## Shared-store expectations

OpenCode and Pi can run in separate processes against the same store. Writes
go through the same shard allocation and write-lock path as OpenCode, and the
same project directory resolves to the same project tag from either host
(`omms_project_<hash>`; rows written by older versions under `opencode_` are
migrated automatically on first start).

## Limitations

- Pi profile learning applies analysed batches directly. The decay,
  validation-task, and conflict-retry machinery of the OpenCode idle path is
  not ported.
- Historical session import is explicit and current-project by default; see
  [pi-history-import.md](pi-history-import.md).
