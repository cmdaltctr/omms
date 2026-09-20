# Design: shared memory core, Pi adapter, and Pi history backfill

## Context

The repository already has reusable services, but OpenCode lifecycle concerns remain mixed into orchestration. The target is a dependency boundary, not a wholesale repository rewrite:

```text
OpenCode adapter ââ
                  â¼
           Shared memory core
                  â²
Pi adapter ââââââââ
```

The shared core owns storage/retrieval, embeddings, privacy, deduplication, project/user identity, profiles, capture/extraction orchestration, cleanup, portability, and host-neutral web/backend behavior. Adapters own lifecycle events, session reading, host UI/notifications, tool registration, and host-native model access.

Pi sessions are durable JSONL trees with a session header including recorded `cwd`, entry IDs/parents, messages, compaction/branch information, and extension state. Import must use Pi-supported APIs from the pinned release rather than a second JSONL implementation.

## Goals

- One memory engine for OpenCode and Pi.
- Existing OpenCode behavior and data remain compatible.
- Prompt-aware Pi retrieval before each run.
- Automatic Pi capture only after the run is fully settled.
- Cross-host provenance without cross-host retrieval silos.
- Safe, resumable, idempotent import of existing Pi history.
- Incremental refactor; no unnecessary monorepo conversion.

## Non-Goals

- Rename `opencode-mem` or its storage directory.
- Replace Turso/libSQL.
- Re-embed all existing memories only to add provenance.
- Merge OpenCode and Pi session files.
- Persist hidden reasoning/thinking content.
- Import binary/image payloads as memory text.
- Import every abandoned Pi branch by default.
- Guarantee every historical turn becomes a memory.

## Decisions

### D1 â One repository; dependency direction defines the boundary

Keep the current package initially. Folder movement is optional; dependency direction is mandatory:

```text
shared core/services  <-- adapters/opencode
shared core/services  <-- adapters/pi
shared core/services  -X-> host SDK types
```

The existing `src/v2/adapter.ts` is a compatibility concern and is not automatically the new host-adapter abstraction.

### D2 â Preserve storage and project identity

Keep the current default `~/.opencode-mem/data` location, shard format, container-tag prefix, vector semantics, and migration behavior.

Both adapters call the same existing project-root/project-identity/tag logic. A Git repository or explicit `.opencode-mem-project` root therefore maps to the same project shard from either host. Renaming the existing `opencode`-named storage identity is deferred.

### D3 â Normalize host conversation input

Shared capture must not accept OpenCode `PluginInput` or Pi SDK types. Use a normalized shape conceptually like:

```ts
interface ConversationSnapshot {
  host: "opencode" | "pi";
  sessionId: string;
  projectDirectory: string;
  userMessage: string;
  assistantText: string[];
  toolCalls: Array<{ name: string; input: string }>;
  sourceTimestamp?: number;
  sourceEntryIds?: string[];
  sourceType: "live-capture" | "history-import";
}
```

Adapters collect host-native state. The shared pipeline applies context budgeting, privacy, extraction/classification, deduplication, embedding, and persistence.

### D4 â Pi retrieval uses `before_agent_start`

Use the incoming prompt for semantic project retrieval and existing user-profile context. Bound results by configured thresholds/count/budget. Prefer Pi's structured pre-agent prompt section (`systemPromptOptions.sections`) or an equivalent supported surface. Do not add a fake user turn, replace the whole prompt unnecessarily, or dump the whole store.

### D5 â Pi automatic capture uses `agent_settled`

`agent_end` is not the primary capture boundary. Current Pi exposes `agent_settled` after automatic retry, compaction, and queued continuation have finished. At that point the adapter reads the current branch and creates one completed snapshot/work unit. Manual memory writes remain immediate.

### D6 â Pi model integration uses the registry plus supported Pi AI APIs

`ctx.modelRegistry` resolves models and credentials. Current Pi also exposes provider-aware model calls such as `modelRegistry.streamSimple()`. Resolve the active/inherited or explicitly configured model through Pi context/registry APIs, then use the supported provider-aware call for structured extraction/profile learning and validate the returned payload with the shared schema.

Provider modes should support inherit/current Pi model, explicit Pi provider/model, and existing direct provider configuration as fallback. Automatic extraction failure must not disable manual memory operations.

### D7 â Provenance is metadata

New memories can carry host, source, host session ID, source entry IDs, source timestamp, source file, and import ID. Host provenance never changes ordinary project retrieval eligibility.

### D8 â History import uses supported Pi session APIs and active-branch semantics

Default root: `~/.pi/agent/sessions`.

For each candidate:
1. open/read with public Pi APIs from the pinned version;
2. migrate in memory through Pi's supported migration path when needed;
3. read session ID and recorded `cwd`;
4. resolve the active/current branch;
5. pair user requests with resulting assistant/tool work;
6. exclude hidden thinking/reasoning, system-only state, images/binary payloads, and extension-only state from memory text;
7. normalize into the same shared capture input.

Prefer `SessionManager.open()`. Current Pi publicly re-exports `parseSessionEntries()` and `migrateSessionEntries()` as well; use them only where they improve supported compatibility/discovery/fixtures, and pin/test the supported Pi release. Never import private source paths.

### D9 â Import idempotency uses deterministic source identity

Semantic deduplication is not an import ledger. Define a stable key such as:

```text
pi:<session-id>:<user-entry-id>:<assistant-terminal-entry-id>
```

A durable ledger records source key, source file/fingerprint, project identity, status, created memory ID if any, skip/failure reason, and timestamps.

Before inserting a memory, attach the deterministic import key to the write path. On restart, if the memory exists but ledger completion did not commit, reconcile to that memory rather than inserting another. Successful/skipped keys are not reprocessed unless explicitly requested.

### D10 â Dry-run is side-effect free

Provide an explicit import command/CLI path, for example:

```text
memory import-pi-history --dry-run
memory import-pi-history
```

Filters include current project, all projects, session ID, since/until date, maximum sessions, and explicit force/reprocess.

Default `--dry-run` performs no extraction-model, embedding, vector, memory, source-session, or ledger writes. It reports discovered sessions, branch/work-unit counts, project mappings, handled keys, and unreadable/unsupported files.

### D11 â Source sessions are immutable

Backfill never modifies Pi JSONL files. Any migration occurs only in memory.

### D12 â Compaction handling stays adapter-local initially

Use Pi's `session_before_compact` / `session_compact` surfaces to preserve memory continuity/bookkeeping without synthetic user turns. Keep current OpenCode compaction behavior intact until a later proposal justifies a generic compaction contract.

## Failure and Safety Rules

- Pi provider/capture failure must not corrupt or block the Pi session.
- History import never deletes or edits source sessions.
- Import writes use the shared persistence path; the current in-process shard write queue is not proof of cross-process safety.
- Privacy filtering occurs before content is sent to an extraction provider.
- Tool inputs remain bounded by existing truncation policy.
- Hidden reasoning is never normalized into imported memory text.
- Cross-process OpenCode/Pi access must be tested before claiming shared-write safety.

## Questions to Resolve Before Implementation

1. **Importer UX surface:** choose the primary operator surface for backfill (Pi command, package CLI, memory-tool mode, or a thin combination over one importer service).
   *Resolved (2026-09-20):* a Pi command over one shared importer service. The command runs inside live Pi, so extraction inherits the active model through `ctx.modelRegistry` with no separate API credentials; a headless bin CLI wrapping the same service stays deferred until a direct-provider use case exists. Recorded as task 3.25.
2. **Cross-process write coordination:** two-process tests must determine whether libSQL transactions are sufficient or a narrow file/advisory lock is required around metadata/shard operations.
   *Resolved (Phase 1/2 work):* the two-process storage test demonstrated real races (per-connection pragma gaps and vector-count drift under concurrent rollover). Fixes shipped: `busy_timeout` plus one pooled handle per client, and a per-scope cross-process advisory write lock nested inside `withScopeWriteLock`.
3. **Provenance and ledger placement:** confirm whether existing metadata JSON plus a global metadata-table ledger gives the cleanest transaction/recovery boundary, or whether project-local ledger state is preferable.
   *Resolved (2026-09-20):* a dedicated SQLite ledger file inside `storagePath` (`import-ledger.db`). Memory rows carry the deterministic `importId` in their metadata JSON for reconciliation; the ledger itself lives in the store so idempotency travels with the data on machine moves.
4. **Pi model-selection policy:** decide whether extraction defaults to the active `ctx.model`, a dedicated configured memory model, or active-model-first with an explicit override.
   *Resolved (Phase 2):* active-model-first. The Pi provider bridge uses `ctx.model` unless the optional `piProvider`/`piModel` configuration names a specific model; manual memory operations never depend on the provider.

## Rollout

### Phase 1 â Shared core extraction + OpenCode parity

Define host-neutral contracts, refactor OpenCode onto them, preserve storage identity, and add parity/compatibility tests.

### Phase 2 â Pi adapter

Add Pi packaging, retrieval, settled capture, Pi-native model bridge, memory tool/commands, provenance, compaction, and shutdown handling.

### Phase 3 â Pi historical-session backfill

Add discovery/session reading, active-branch work units, import ledger/reconciliation, dry-run/filters, version fixtures, and cross-host end-to-end tests.

## Validation

Complete only when:
1. existing OpenCode tests pass;
2. pre-change data opens and searches without forced re-embedding;
3. Pi retrieves OpenCode-created project memory;
4. OpenCode retrieves Pi-created project memory;
5. Pi auto-capture occurs at `agent_settled`, not prematurely at `agent_end`;
6. Pi compaction does not require fake user turns;
7. importing the same history twice creates zero duplicate memories;
8. crash-window reconciliation does not duplicate memory;
9. dry-run performs zero model/embedding/vector/memory/ledger writes;
10. malformed sessions are isolated and reported;
11. source Pi JSONL files remain byte-for-byte unchanged.


## Verified Pi API Baseline — 2026-09-19

Reference: upstream `earendil-works/pi`, coding-agent package `@earendil-works/pi-coding-agent` version `0.85.1`.

Verified public surfaces from the package root:

- lifecycle events: `before_agent_start`, `agent_settled`, `session_before_compact`, `session_compact`, and `session_shutdown`;
- `agent_settled` is documented as firing only after automatic retry, compaction, and queued continuation are finished;
- `before_agent_start` can return a custom message or a complete `systemPrompt` override;
- `ExtensionContext` exposes `cwd`, read-only `sessionManager`, `modelRegistry`, current `model`, UI, and shutdown/compaction state;
- `ModelRegistry` exposes `find()`, `getAvailable()`, auth resolution, `stream()`, `streamSimple()`, and `complete()`;
- `SessionManager.open(path)` reads the header cwd and opens a historical session;
- the read-only session surface exposes `getSessionId()`, `getSessionFile()`, `getLeafId()`, `getBranch()`, `buildContextEntries()`, `getHeader()`, and `getEntries()`;
- `parseSessionEntries()` and `migrateSessionEntries()` are root exports in 0.85.1, although their source comments describe test-oriented use.

This baseline must be rechecked when upgrading the Pi dependency.
