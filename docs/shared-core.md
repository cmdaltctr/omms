# Shared Memory Core Boundary

OMMS runs one memory engine behind three host adapters: the OpenCode plugin,
the Pi coding-agent extension, and the Claude Code hooks. This page sets out:

- the boundary between the shared code and the adapters
- the import rules
- the compatibility promise for existing data

## Layout and import direction

```text
               src/core + src/services + src/importer
                   (shared memory core and engine)
                  ▲               ▲               ▲
                  │               │               │
     src/adapters/opencode   src/adapters/pi   src/adapters/claude-code
     + src/index.ts          (Pi extension)    (hook client, reached
     + src/v2 (compat)                         through src/cli)
```

Rules:

- `src/core/*` and `src/services/*` must not import host SDKs
  (`@opencode-ai/*`, `@earendil-works/*`) or anything from `src/adapters/*`.
  `tests/host-neutral-capture-boundary.test.ts` and
  `tests/pi-adapter-boundary.test.ts` enforce this.
- `src/core/*`, `src/services/*`, and `src/types/*` must not import
  `src/importer/*`. The one exception is `src/services/web-server.ts`. It
  reaches the importer only through dynamic imports of
  `src/importer/web-import-api.ts`, `src/importer/settings-health.ts`,
  `src/importer/web-import-jobs.ts`, `src/importer/settings-models.ts`, and
  `src/importer/claude-hook-api.ts`. `tests/pi-adapter-boundary.test.ts`
  enforces this.
- The OpenCode entry points (`src/index.ts`, `src/v2/adapter.ts`,
  `src/v2/plugin.ts`) must not import `importer/` or `@earendil-works`
  directly. They load importer code through `src/adapters/opencode/*`.
- Adapters own everything that is specific to a host: lifecycle events,
  session reading, host UI, host model access, and tool registration.
- An adapter must not import another host's host-coupled modules.
- `src/adapters/claude-code/*` must not import the OpenCode or Pi adapters, or
  a host SDK. `src/core/*`, `src/services/*`, `src/importer/*`, `src/types/*`,
  and the OpenCode and Pi hosts must not import it. Only `src/cli/index.ts`
  loads it, with dynamic `import()`.
  `tests/claude-code-adapter-boundary.test.ts` enforces this.
- The Claude Code hook client loads no store and no embedding model. It sends
  each hook event to the web app, which does the memory work.
- Load host SDKs and heavy modules with dynamic `import()`.
  `tests/plugin-bundle-boundary.test.ts` checks the plugin bundle. It also
  checks that the OpenCode and Pi bundles do not include
  `adapters/claude-code`.

`src/importer/` is shared by all hosts and never imports an adapter.
`tests/pi-adapter-boundary.test.ts` checks this.

- The readers for each host's history format live in the importer:
  `opencode-reader.ts` for OpenCode's database, `pi-conversation.ts`
  with `session-loader.ts` for Pi session files, and `claude-conversation.ts`
  with `claude-reader.ts` for Claude Code transcripts.
- The Pi adapter imports `pi-conversation.ts` for live capture. Adapters may
  depend on shared code; shared code never depends on an adapter.
- `pi-sdk.ts` loads the Pi SDK with dynamic `import()`. When OMMS's own
  dependencies lack it, it uses the copy in Pi's install. `session-loader.ts`,
  `import-readiness.ts`, and `settings-models.ts` get the SDK through it, only
  when they read Pi history or Pi's model list.
- Only these importer files name a host SDK. The boundary test checks every file.
- OpenCode's model access for web imports, Health, and Settings reaches the
  importer through `registerOpencodeHostModels` in `backfill-controls.ts`.
  The OpenCode adapter registers it at plugin start. With nothing registered,
  as in the standalone web app, OpenCode models report as unavailable.
- `src/core/internal-prompt.ts` recognises omms's own summary and profile
  prompts, which are the same text on every host.

## Ports (`src/core/host.ts`)

The shared capture pipeline depends on two interfaces only:

- `CaptureSummaryProvider.summarize(request)` does structured extraction.
  - The OpenCode provider path (`src/adapters/opencode/opencode-provider.ts`) and the Pi model bridge (`src/adapters/pi/provider.ts`) both implement it.
  - Throw to defer or skip the work unit. Do not return partial data. Manual memory operations stay available.
- `AutoCaptureHost` extends `CaptureSummaryProvider`. It adds session
  conversation access (`getConversation`), readiness (`isCaptureReady`), and
  optional notifications (`notify`).
  - The OpenCode adapter implements it.
  - The Pi adapter calls `captureConversation` directly from `agent_settled`.
  - For Claude Code, `src/importer/claude-hook-api.ts` in the web app calls
    `captureConversation` with the external API provider from
    `selectImportModel`.

`ModelPort` in `src/core/profile-analysis.ts` is the profile model port.
It has `complete` for plain text and an optional `completeStructured` for
host-enforced JSON. Profile dedup, conflict, description, and cleanup calls in
`src/services/user-profile/` use the model a host registers with
`registerHostProfileModel` (`profile-model.ts`). With none, they use the
external API. OpenCode registers `adaptOpencodeProfileModel`. Pi registers
nothing, so its behaviour does not change. Claude Code registers nothing. Its
profile learning calls the external API profile model directly, because a
registration applies to the whole process. When the web app runs inside
OpenCode, a Claude Code registration would replace OpenCode's model.

`CaptureWorkUnit` in `src/core/capture.ts` is the only shape the shared
pipeline accepts. It holds visible conversation content and provenance.
Hidden reasoning and host SDK objects never go into it.

## What each layer owns

| Layer                                               | Owns                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core`                                          | Ports, capture pipeline, context budgeting, shared extraction schema and parsing, retrieval, `memory` tool operations                                                                 |
| `src/services`                                      | Storage (Turso/libSQL), embeddings, vector search, privacy, deduplication, project identity, profiles, portability, cleanup, web backend, live-model rule (`ai/live-model-choice.ts`) |
| `src/importer`                                      | History import and automatic backfill, import ledger, import runs and progress, backfill controls, path maps, the web import API                                                      |
| `src/adapters/opencode` + `src/index.ts` + `src/v2` | OpenCode lifecycle, session reading, provider bridge, OpenCode model code and profile learning, OpenCode backfill model resolver, V2 compatibility                                    |
| `src/adapters/pi`                                   | Pi lifecycle (`session_start`, `before_agent_start`, `agent_settled`, `session_shutdown`), retrieval injection, model bridge, Pi backfill model resolver, `memory` tool registration  |
| `src/adapters/claude-code`                          | The `claude-hook <event>` command: hook input, finding or starting the web app, one request, added context output, one log line. No store and no model                                |

### Shared modules added for import and settings

| Module                                                 | Purpose                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/importer/import-runs.ts`                          | Progress for each host's import run, and one run at a time for each host across every surface (`auto`, `web`, `cli`, `slash`) |
| `src/importer/backfill-controls.ts`                    | Run now, Pause, and Resume. Each host registers its backfill model resolver with `registerHostBackfillModels`                 |
| `src/importer/external-backfill-models.ts`             | Backfill models from the external API settings (`memoryModel`, `memoryApiUrl`, `memoryApiKey`)                                |
| `src/importer/external-api-test.ts`                    | A short test call to the external API                                                                                         |
| `src/importer/import-path-maps.ts`                     | Checks and normalises `importPathMaps` from the global config                                                                 |
| `src/importer/map-suggestions.ts`                      | Suggests path maps by looking for project markers such as `.git` and `package.json`                                           |
| `src/importer/settings-health.ts`                      | Settings health checks for the web UI                                                                                         |
| `src/importer/web-import-api.ts`, `web-import-jobs.ts` | The importer functions and jobs that the web server calls                                                                     |
| `src/services/private-path.ts`                         | Limits a file or folder to the current user. Capture traces and `memory-key-source.ts` use it                                 |
| `src/services/memory-key-source.ts`                    | How the web UI External API card supplies `memoryApiKey` (`env`, `file`, or a pasted value)                                   |
| `src/services/global-version.ts`                       | The version of the global `om-memory-system` command, if installed                                                            |
| `src/services/package-version.ts`                      | This package's version, read from its `package.json`                                                                          |

### Shared modules added for Claude Code

| Module                                  | Purpose                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/importer/claude-conversation.ts`   | Pure transcript parsing and window building, for live capture and history import                             |
| `src/importer/claude-reader.ts`         | Transcript discovery under `~/.claude/projects` or `--root`, as a `LazyImportSource`                         |
| `src/importer/claude-import.ts`         | `importClaudeHistory`: the shared importer, ledger, and profile steps with host `claude-code`                |
| `src/importer/claude-hook-api.ts`       | Web app handlers for `POST /api/claude/retrieve` and `POST /api/claude/capture`, capture worker, retry drain |
| `src/services/claude-capture-cursor.ts` | The last captured user entry for each Claude Code session, in `user-prompts.db`                              |
| `src/cli/memory-command.ts`             | `om-memory-system memory <mode>`: the shared `memory` operations from a terminal, with host `claude-code`    |
| `src/types/host-label.ts`               | `hostLabel()`: the display name of each host                                                                 |

`resolveClaudeCodeLiveModel` in `src/services/ai/live-model-choice.ts` is the
Claude Code model rule: the external API only. See
[ADR-013](adr/013-claude-code-host-through-hooks-and-web-app.md).

## Cross-process storage safety

OpenCode, Pi, the web app, and the `memory` command can run in separate
processes against the same store:

- Every connection sets `busy_timeout=5000` and uses one pooled handle.
- Every write goes through `withScopeWriteLock`. It nests a cross-process
  lock for each scope (`src/services/turso/cross-process-write-lock.ts`).
  That lock checks if the owner PID is alive and takes over stale locks.
- So shard allocation, vector-count sync, insert, and increment run as one
  critical section for each scope, across processes.
- Races to create a shard end at the `UNIQUE(scope, scope_hash, shard_index)`
  constraint. The loser reads the row again and uses it.
- `tests/two-process-storage.test.ts` checks this with two spawned processes
  on the production write path. It covers concurrent start, mixed
  same-project writes, read-after-write, close and reopen, exact counts, and
  rollover.

The default rollback journal is on purpose. File-level migration copies need
the main database file to be current after every commit.

## Compatibility promise for existing OpenCode data

Phase 1 kept these, and later phases must keep them:

1. The default store is `~/.omms/data`.
   - A one-time verified migration moves it from `~/.opencode-mem/data` (see [omms-migration.md](omms-migration.md)).
   - The legacy folder is backed up and copied, never changed.
   - Storage uses the legacy layout until the migration succeeds.
   - The container tag prefix changed from `opencode_project_<hash>` to `omms_project_<hash>`. A one-time verified rewrite of stored rows did this, with a backup first.
   - The same project folder resolves to the same shard set from any host.
2. Memories written before provenance fields existed stay valid and
   searchable. Provenance (`host`, `hostSessionId`, `sourceType`,
   `sourceEntryIds`, `sourceTimestamp`, `sourceFile`, `importId`) is optional
   metadata. It never controls retrieval.
3. An upgrade never needs new embeddings. Schema changes must only add, and
   must be safe to run again on open.
4. The OpenCode V1 entry point (`src/index.ts`) keeps its behaviour.
   - The V2 entry (`src/v2/adapter.ts`) uses native V2 session hooks.
   - It retrieves for each prompt through the shared `src/core/retrieval.ts`, the same code Pi uses.
   - It restores memories after compaction through the `compaction` hook.
   - The `memory` tool, idle capture, and profile learning still go through the shared operations layer.

## Add a new host adapter

1. Implement `CaptureSummaryProvider` for the host's model runtime.
2. Convert the host's transcript into `CaptureConversation`. Include visible text and bounded tool inputs only.
3. Call `captureConversation` with a `CaptureWorkUnit` that carries provenance.
4. Send the host's `memory` tool calls through `executeMemoryOperation`.
5. Register a backfill model resolver with `registerHostBackfillModels`.
6. Add the same features as the other hosts, so all hosts stay equal.
7. Add boundary tests. Keep host SDKs out of the shared path. Use type-only host imports in the adapter.
