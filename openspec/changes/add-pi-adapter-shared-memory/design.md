# Design: shared memory core, Pi adapter, and Pi history backfill

## Context

The repository already has reusable services, but OpenCode lifecycle concerns remain mixed into orchestration. The target is a dependency boundary, not a wholesale repository rewrite:

```text
OpenCode adapter ─┐
                  ▼
           Shared memory core
                  ▲
Pi adapter ───────┘
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

### D1 — One repository; dependency direction defines the boundary

Keep the current package initially. Folder movement is optional; dependency direction is mandatory:

```text
shared core/services  <-- adapters/opencode
shared core/services  <-- adapters/pi
shared core/services  -X-> host SDK types
```

The existing `src/v2/adapter.ts` is a compatibility concern and is not automatically the new host-adapter abstraction.

### D2 — Preserve storage and project identity

Keep the current default `~/.opencode-mem/data` location, shard format, container-tag prefix, vector semantics, and migration behavior.

Both adapters call the same existing project-root/project-identity/tag logic. A Git repository or explicit `.opencode-mem-project` root therefore maps to the same project shard from either host. Renaming the existing `opencode`-named storage identity is deferred.

### D3 — Normalize host conversation input

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

### D4 — Pi retrieval uses `before_agent_start`

Use the incoming prompt for semantic project retrieval and existing user-profile context. Bound results by configured thresholds/count/budget. Inject through Pi's supported pre-agent/system-context surface. Do not dump the whole store.

### D5 — Pi automatic capture uses `agent_settled`

`agent_end` is not the primary capture boundary. Current Pi exposes `agent_settled` after automatic retry, compaction, and queued continuation have finished. At that point the adapter reads the current branch and creates one completed snapshot/work unit. Manual memory writes remain immediate.

### D6 — Pi model integration uses the registry plus supported Pi AI APIs

`ctx.modelRegistry` resolves models/credentials; it is not itself a text-generation method. Resolve the active/inherited or explicitly configured model through the registry, then use the pinned Pi release's supported AI completion/streaming API for structured extraction/profile learning.

Provider modes should support inherit/current Pi model, explicit Pi provider/model, and existing direct provider configuration as fallback. Automatic extraction failure must not disable manual memory operations.

### D7 — Provenance is metadata

New memories can carry host, source, host session ID, source entry IDs, source timestamp, source file, and import ID. Host provenance never changes ordinary project retrieval eligibility.

### D8 — History import uses supported Pi session APIs and active-branch semantics

Default root: `~/.pi/agent/sessions`.

For each candidate:
1. open/read with public Pi APIs from the pinned version;
2. migrate in memory through Pi's supported migration path when needed;
3. read session ID and recorded `cwd`;
4. resolve the active/current branch;
5. pair user requests with resulting assistant/tool work;
6. exclude hidden thinking/reasoning, system-only state, images/binary payloads, and extension-only state from memory text;
7. normalize into the same shared capture input.

Prefer `SessionManager.open()`. Use `parseSessionEntries()` / `migrateSessionEntries()` only if they are public exports in the pinned version. Never import private source paths.

### D9 — Import idempotency uses deterministic source identity

Semantic deduplication is not an import ledger. Define a stable key such as:

```text
pi:<session-id>:<user-entry-id>:<assistant-terminal-entry-id>
```

A durable ledger records source key, source file/fingerprint, project identity, status, created memory ID if any, skip/failure reason, and timestamps.

Before inserting a memory, attach the deterministic import key to the write path. On restart, if the memory exists but ledger completion did not commit, reconcile to that memory rather than inserting another. Successful/skipped keys are not reprocessed unless explicitly requested.

### D10 — Dry-run is side-effect free

Provide an explicit import command/CLI path, for example:

```text
memory import-pi-history --dry-run
memory import-pi-history
```

Filters include current project, all projects, session ID, since/until date, maximum sessions, and explicit force/reprocess.

Default `--dry-run` performs no extraction-model, embedding, vector, memory, source-session, or ledger writes. It reports discovered sessions, branch/work-unit counts, project mappings, handled keys, and unreadable/unsupported files.

### D11 — Source sessions are immutable

Backfill never modifies Pi JSONL files. Any migration occurs only in memory.

### D12 — Compaction handling stays adapter-local initially

Use Pi's `session_before_compact` / `session_compact` surfaces to preserve memory continuity/bookkeeping without synthetic user turns. Keep current OpenCode compaction behavior intact until a later proposal justifies a generic compaction contract.

## Failure and Safety Rules

- Pi provider/capture failure must not corrupt or block the Pi session.
- History import never deletes or edits source sessions.
- Import writes use the existing shard write-lock path.
- Privacy filtering occurs before content is sent to an extraction provider.
- Tool inputs remain bounded by existing truncation policy.
- Hidden reasoning is never normalized into imported memory text.
- Cross-process OpenCode/Pi access must be tested before claiming shared-write safety.

## Questions to Resolve Before Implementation

1. **Pi dependency policy:** pin the exact current Pi package/version and public import paths.
2. **Pi internal generation API:** select the supported completion/streaming call used after model/credential resolution through `ctx.modelRegistry`.
3. **Importer session API:** confirm which parser/migration helpers are public exports; prefer `SessionManager.open()` if lower-level helpers are internal/test-only.
4. **Cross-process write safety:** verify existing libSQL/Turso locking under simultaneous OpenCode and Pi processes; otherwise define retry/single-writer behavior without changing storage identity.
5. **Provenance persistence shape:** decide whether existing metadata JSON is sufficient or an additive schema change is needed.
6. **Import ledger placement:** prefer a small additive table in the same local store unless concurrency/migration constraints argue for a separate local ledger.
7. **Pi tool parity:** map OpenCode operations to Pi tools/commands by semantics, not by forcing identical host UI.

## Rollout

### Phase 1 — Shared core extraction + OpenCode parity

Define host-neutral contracts, refactor OpenCode onto them, preserve storage identity, and add parity/compatibility tests.

### Phase 2 — Pi adapter

Add Pi packaging, retrieval, settled capture, Pi-native model bridge, memory tool/commands, provenance, compaction, and shutdown handling.

### Phase 3 — Pi historical-session backfill

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
