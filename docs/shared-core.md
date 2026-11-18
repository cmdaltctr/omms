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
     + src/v2                (Pi extension)    (hook client, reached
                                               through src/cli)

     src/shared (host registry, API types; no imports outside itself)
     src/utils  (pure helpers and config parsers; no importer imports)
     Every layer and the web app may import src/shared.
```

Rules:

- `src/core/*`, `src/services/*`, `src/types/*`, `src/utils/*`,
  `src/shared/*`, and `src/config.ts` must not import host SDKs
  (`@opencode/*`, `@opencode-ai/*`, `@earendil-works/*`).
  `tests/module-boundaries.test.ts` enforces this for every file in those
  folders. `tests/host-neutral-capture-boundary.test.ts` and
  `tests/pi-adapter-boundary.test.ts` check the capture path and the Pi
  readers.
- `src/core/*` and `src/services/*` must not import anything from
  `src/adapters/*`.
- `src/shared/*` imports only `src/shared/*` and packages, so the web app can
  use it through `$shared`. `tests/module-boundaries.test.ts` enforces this.
- `src/config.ts` must not import `src/importer/*`. Config parsers live in
  `src/utils/backfill-model.ts` and `src/utils/import-path-config.ts`.
  `tests/config-boundary.test.ts` enforces this.
- `src/utils/*` and `src/config.ts` must not import `src/adapters/*`,
  `src/v2/*` or `src/plugin.ts`. `tests/module-boundaries.test.ts` enforces
  this.
- Shared code must not compare host names, switch on them, or list them. Read
  host facts from the host registry (see [Host registry](#host-registry)).
  `tests/host-branch-boundary.test.ts` enforces this. It reads the syntax tree
  and fails on a host id (`pi`, `opencode`, `claude-code`, or the command name
  `claude`) in an equality check or a `case`, and on two or more host ids in
  one array, union type, regex, `Set` or `Map` keys.
- `src/core/*`, `src/services/*`, and `src/types/*` must not import
  `src/importer/*`. The one exception is `src/services/web-server.ts`. It
  reaches the importer only through dynamic imports of
  `src/importer/web-import-api.ts`, `src/importer/settings-health.ts`,
  `src/importer/web-import-jobs.ts`, `src/importer/settings-models.ts`, and
  `src/importer/claude-hook-api.ts`. `tests/pi-adapter-boundary.test.ts`
  enforces this.
- The OpenCode entry points (`src/v2/adapter.ts`, `src/v2/plugin.ts`,
  `src/v2/startup.ts`) must not import `importer/` or `@earendil-works`
  directly. They load importer code through `src/adapters/opencode/*`.
- Only the OpenCode host (`src/adapters/opencode/`, `src/v2/`,
  `src/plugin.ts`) imports `src/v2/*` or `src/plugin.ts`.
  `tests/module-boundaries.test.ts` enforces this.
- Adapters own everything that is specific to a host: lifecycle events,
  session reading, host UI, host model access, and tool registration.
- An adapter must not import another host's adapter.
  `tests/module-boundaries.test.ts` checks every pair of folders under
  `src/adapters/`, read at run time, so a new host folder is checked too.
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

## Host registry

Shared code reads host facts from two files. Both are keyed by `MemoryHost`,
so a host with no entry is a compile error. See
[ADR-050](adr/050-one-host-registry-and-modularity-ratchets.md).

| File                             | Holds                                                                                                                                                                                                                                                                         | Who imports it                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `src/shared/hosts.ts`            | `HOSTS` (the one host list, in API key order), `MemoryHost`, `isMemoryHost`, `hostLabel`, `hostLabelList`, `hostChoiceMessage`, and `HOST_INFO`: label, article, command name, session model, session commands, backfill-model config key, history source option. No imports. | Every layer, and `web/src/` through `$shared` |
| `src/importer/host-importers.ts` | `HOST_IMPORTERS`: default source path, source check, picker start folder and file kind, session listing, import run, reader check, worktree hints, Settings model list. Readers that load the storage engine stay behind `import()`. Callers pass config values in.           | Importer modules only                         |

- Hosts do not register at run time. The web app serves every host with no
  adapter loaded, so the registry is static.
- `ImportHost`, `BackfillHost` and the web `WebHost` are aliases of
  `MemoryHost`. Do not write a host union anywhere else.
- To check a value from a request or a row, use `isMemoryHost`. To loop over
  hosts or build an object with one key per host, use `HOSTS`.
- A host difference goes into `HostInfo` or `HostImporter` as a field, not
  into an `if` on the host name. The live-model rule stays in
  `src/services/ai/live-model-choice.ts`, in its `LIVE_MODELS` table.
- Run-time registrations carry access to a running host's model, not host
  identity: `registerHostProfileModel`, `registerOpencodeHostModels`, and
  `registerHostBackfillModels`.
- `tests/host-registry.test.ts` checks the host list and each host fact. The
  boundary tests share one import scanner, `tests/source-imports.ts`.

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

## Profile learning (`src/core/profile-learning/`)

Every host runs live profile learning through one pass ([ADR-052](adr/052-one-profile-learning-pass-for-every-host.md)). The folder holds:

| File             | Holds                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `settings.ts`    | The six global-only settings, their defaults, the parser and the edit checks                          |
| `model-input.ts` | The full input, the prompts-only input and the UTF-8 byte cut                                         |
| `validation.ts`  | The check of older items: the task text and `applyValidations`                                        |
| `fallback.ts`    | `withExternalFallback(host, primary, external, notify)`: a host model with the external API behind it |
| `pass.ts`        | `runProfileLearningPass(input)`: the steps of a pass, the history text and the notice text            |

The pass takes its ports in one input object:

- `host` and `directory`. The host only picks the label from `HOST_INFO` and the host field of the failure log record.
- `config`: the adapter passes `CONFIG` after `refreshConfigIfChanged(directory)`. The pass never imports `src/config.ts`.
- `model`: a function that returns a `ModelPort`, or null to skip the pass. `analyzeProfile` calls `completeStructured` when the port has it, and `complete` otherwise. It checks every reply against the shared schema.
- `notify` (optional): shows a notice. Claude Code keeps the line for a later hook.
- `cleanupModel` (optional): the model of the automatic cleanup that the pass starts. Without it the cleanup uses the external API.

The pass returns `{ outcome: "saved" | "skipped" | "failed", reason? }` and never throws. It reads prompts from `userPromptManager` and the profile from `userProfileManager`. It saves through `saveMergedProfile`, which applies the decay and validation hooks on every attempt. One pass runs at a time in a process, and a failure starts the 10-minute wait in `profileBackoff`.

## What each layer owns

| Layer                              | Owns                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core`                         | Ports, capture pipeline, context budgeting, shared extraction schema and parsing, retrieval, `memory` tool operations                                                                 |
| `src/services`                     | Storage (Turso/libSQL), embeddings, vector search, privacy, deduplication, project identity, profiles, portability, cleanup, web backend, live-model rule (`ai/live-model-choice.ts`) |
| `src/importer`                     | History import and automatic backfill, import ledger, import runs and progress, backfill controls, path maps, the web import API                                                      |
| `src/adapters/opencode` + `src/v2` | OpenCode lifecycle, session reading, provider bridge, OpenCode model code and profile learning, OpenCode backfill model resolver, the V2 plugin (startup, tools, events, hooks)       |
| `src/adapters/pi`                  | Pi lifecycle (`session_start`, `before_agent_start`, `agent_settled`, `session_shutdown`), retrieval injection, model bridge, Pi backfill model resolver, `memory` tool registration  |
| `src/adapters/claude-code`         | The `claude-hook <event>` command: hook input, finding or starting the web app, one request, added context output, one log line. No store and no model                                |

### Shared modules added for import and settings

| Module                                                 | Purpose                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/importer/import-runs.ts`                          | Progress for each host's import run, and one run at a time for each host across every surface (`auto`, `web`, `cli`, `slash`) |
| `src/importer/backfill-controls.ts`                    | Run, Pause, and Resume. Each host registers its backfill model resolver with `registerHostBackfillModels`                     |
| `src/importer/external-backfill-models.ts`             | Backfill models from the external API settings (`memoryModel`, `memoryApiUrl`, `memoryApiKey`)                                |
| `src/importer/external-api-test.ts`                    | A short test call to the external API                                                                                         |
| `src/utils/import-path-config.ts`                      | Checks and normalises `importPathMaps` and `importIgnoredDirectories` from the global config                                  |
| `src/importer/import-path-maps.ts`                     | Merges the saved path maps with a run's own maps                                                                              |
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

`resolveClaudeCodeLiveModel` in `src/services/ai/live-model-choice.ts` is the
Claude Code model rule: the external API only. See
[ADR-013](adr/013-claude-code-host-through-hooks-and-web-app.md).

## Cross-process storage safety

OpenCode, Pi, the web app, and the `memory` command can run in separate
processes against the same store:

- Every connection sets `busy_timeout=5000` and `foreign_keys=ON` and uses
  one pooled handle. It sets both again after each transaction, because the
  libSQL client opens a fresh handle without them.
- Every write goes through `withScopeWriteLock`. It nests a cross-process
  lock for each scope (`src/services/turso/cross-process-write-lock.ts`).
  That lock publishes a complete PID payload through a hard link before
  entering the write section. It checks if the owner PID is alive and takes
  over stale locks. See [TDR-039](tdr/039-publish-complete-cross-process-write-locks.md).
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
4. The OpenCode plugin is V2 only. Older OpenCode versions cannot load it.
   - The V2 entry (`src/v2/adapter.ts`) uses native V2 session hooks.
   - It retrieves for each prompt through the shared `src/core/retrieval.ts`, the same code Pi uses.
   - It restores memories after compaction through the `compaction` hook.
   - The `memory` tool, idle capture, and profile learning still go through the shared operations layer.

## Ratchets

`tests/modularity-ratchets.test.ts` limits three known debts. Each has a
baseline of files with a count per file, like
`tests/file-size-ceiling.test.ts`.

| Ratchet          | Scope                                   | Counts                                                        | Follow-up it guards |
| ---------------- | --------------------------------------- | ------------------------------------------------------------- | ------------------- |
| `CONFIG` imports | `src/core/`, `src/services/`            | Non-type import sites of `src/config.ts`                      | Config injection    |
| Storage imports  | All `src/` except `src/services/turso/` | Import sites of `@libsql/client` or `src/services/turso/*`    | Storage port        |
| Raw SQL          | All `src/` except `src/services/turso/` | String literals that start with an SQL statement (upper case) | Storage port        |

- A file not in a baseline must have a count of 0.
- A listed file may not go above its count.
- When a listed file goes below its count, write the new count. The test fails and tells you the number.
- When a listed file reaches 0, delete its entry. The test fails until you do.
- Each ratchet has a minimum file count, so an empty scan cannot pass.
- Only `src/config.ts` may export `CONFIG`. A re-export in another file fails the test, so it cannot hide an import from the `CONFIG` ratchet.

To pass a ratchet, take config as an argument (pattern:
`src/services/ai/live-model-choice.ts`), or put the storage code in
`src/services/turso/`. Do not raise a count.

## Add a new host adapter

Write the host's own code first:

1. Create `src/adapters/<host>/`. Implement `CaptureSummaryProvider` for the host's model runtime, or use the external API as Claude Code does.
2. Put the history reader and its import function in `src/importer/` (for example `<host>-reader.ts` and `<host>-import.ts`). Convert the host's transcript into `CaptureConversation`. Include visible text and bounded tool inputs only.
3. Call `captureConversation` with a `CaptureWorkUnit` that carries provenance.
4. Send the host's `memory` tool calls through `executeMemoryOperation`.

Then edit these 4 shared `src/` files. Add the host id to `HOSTS` first: the
compiler then names files 2 and 3, because each holds a per-host table keyed by
`MemoryHost`.

1. `src/shared/hosts.ts`: the id in `HOSTS` and one `HOST_INFO` entry (label, article, command name, session model, session commands, backfill-model key, source option).
2. `src/importer/host-importers.ts`: one `HOST_IMPORTERS` entry (default source, source check, picker, session listing, import run, reader check, worktree hints, Settings model list or `null`).
3. `src/services/ai/live-model-choice.ts`: one `LIVE_MODELS` entry (the live-model status and whether it picks the external API). CLAUDE.md keeps the live-model rule in this file.
4. `src/cli/index.ts`: the `import-<name>-history` line in the help text and in the "Expected ..." message. The compiler does not see this file. Its text lists OpenCode first, so building it from `HOSTS` would change the output. The command map itself comes from `HOSTS`.

Everything else is built from the registry: the import source flags, the default source checks, the import run rows, the per-host API objects (capture saves, retry counts, directory-map suggestions, live-model statuses), the host routes in the web app, and the "Choose Pi, OpenCode, or Claude Code" messages.

Extra edits only when they apply:

- A host that lends its session model: `src/config.ts` and `src/config-template.ts` (host model keys), the `backfillModelKey` type in `src/shared/hosts.ts`, and the model check at the end of `importBlockedReason` in `src/importer/import-readiness.ts`. Its adapter registers a backfill model resolver with `registerHostBackfillModels`.
- A source flag that is not `--root` or `--db`: the `flag` type in `src/shared/hosts.ts` and the `--root`/`--db` case in `src/importer/import-args.ts`.
- Health rows for the host: `src/importer/settings-health.ts`.

Outside `src/`:

- The web app: the compiler names 9 files that hold a per-host record (all under `web/src/lib/`). Other web components still list hosts by hand; no test covers them yet.
- `tests/host-registry.test.ts` lists the hosts. Add the new host there.
- A new bundled entry point goes in `package.json` and `scripts/verify-package.mjs`. `tests/plugin-bundle-boundary.test.ts` checks the bundles.

Add the same features as the other hosts, so all hosts stay equal. Keep host
SDKs out of the shared path. Use type-only host imports in the adapter.
`tests/module-boundaries.test.ts` checks the new adapter folder against the
others with no edit.
