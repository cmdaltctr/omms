# Shared Memory Core Boundary

`opencode-mem` runs one memory engine behind two host adapters: the OpenCode
plugin and the Pi coding-agent extension. This document defines the boundary,
the dependency rules, and the compatibility guarantee for existing data.

## Layout and dependency direction

```text
              src/core + src/services
            (shared memory core/engine)
                     ▲         ▲
                     │         │
        src/adapters/opencode   src/adapters/pi
        + src/index.ts          (Pi extension)
        + src/v2 (compat)
```

Mandatory direction:

- `src/core/*` and `src/services/*` MUST NOT import host SDKs
  (`@opencode-ai/*`, `@earendil-works/*`) or anything from `src/adapters/*`.
  Enforced by `tests/host-neutral-capture-boundary.test.ts` and
  `tests/pi-adapter-boundary.test.ts`.
- Host adapters import the core through narrow ports and own everything
  host-specific: lifecycle events, session reading, host UI, host-native model
  access, and tool registration.
- Adapters never import each other's host-coupled modules.

## Ports (src/core/host.ts)

The shared capture pipeline depends on two interfaces, nothing else:

- `CaptureSummaryProvider.summarize(request)` — structured extraction. The
  OpenCode provider path (`services/ai/*`) and the Pi model bridge
  (`adapters/pi/provider.ts`) both implement it. Failure semantics: throw to
  defer or skip the work unit; manual memory operations stay available.
- `AutoCaptureHost` — session conversation access, readiness, notifications.
  The OpenCode adapter implements it; the Pi adapter drives
  `captureConversation` directly from `agent_settled`.

The normalised work unit (`CaptureWorkUnit` in `src/core/capture.ts`) carries
visible conversation content plus provenance and is the only shape the shared
pipeline accepts. Hidden reasoning and host SDK objects never enter it.

## What each layer owns

| Layer                                               | Owns                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core`                                          | Ports, capture pipeline, context budgeting, shared extraction schema/parsing, memory tool operations                                     |
| `src/services`                                      | Storage (Turso/libSQL), embeddings, vector search, privacy, deduplication, project identity, profiles, portability, cleanup, web backend |
| `src/adapters/opencode` + `src/index.ts` + `src/v2` | OpenCode lifecycle, session reading, provider bridge, v2 compatibility                                                                   |
| `src/adapters/pi`                                   | Pi lifecycle (`before_agent_start`, `agent_settled`, `session_shutdown`), retrieval injection, model bridge, memory tool registration    |

## Cross-process storage safety

OpenCode and Pi can run in separate processes against the same store:

- Every connection sets `busy_timeout=5000` and uses one pooled handle.
- Every write flows through `withScopeWriteLock`, which now nests a
  per-scope cross-process advisory lock
  (`src/services/turso/cross-process-write-lock.ts`, PID-liveness, stale
  reclaim) so shard allocation, vector-count sync, insert, and increment run
  as one critical section per scope across processes.
- Shard creation races resolve through the `UNIQUE(scope, scope_hash,
shard_index)` constraint with re-read adoption.
- Verified by `tests/two-process-storage.test.ts` (two spawned processes,
  production write path): concurrent init, interleaved same-project writes,
  read-after-write, close/reopen durability, exact counts, and rollover.

The default rollback journal is deliberate: file-level migration copies rely
on the main database file being current after every commit.

## Compatibility guarantee for existing OpenCode data

Phase 1 preserved, and later phases must preserve:

1. The default store is `~/.omms/data`, established by a one-time verified
   migration from `~/.opencode-mem/data` (see
   [omms-migration.md](omms-migration.md)): the legacy directory is backed up
   and copied, never modified, and storage keeps resolving to the legacy
   layout until the migration succeeds. The container tag prefix moved from
   the historical `opencode_project_<hash>` to `omms_project_<hash>` via a
   one-time verified rewrite of stored rows (same backup-first pattern). The
   same project directory resolves to the same shard set from either host.
2. Memories written before provenance fields existed remain valid and
   searchable. Provenance (`host`, `hostSessionId`, `sourceType`,
   `sourceEntryIds`, `sourceTimestamp`, `sourceFile`, `importId`) is optional
   metadata and never gates retrieval.
3. No re-embedding is required to upgrade. Schema changes must be additive
   and idempotent on open.
4. The OpenCode plugin entry points (`src/index.ts`, `src/v2/adapter.ts`)
   keep their existing behaviour; the v2 bridge routes through the shared
   operations layer.

## Adding a new host adapter

1. Implement `CaptureSummaryProvider` for the host's model runtime.
2. Normalise the host's transcript into `CaptureConversation` (visible text
   and bounded tool inputs only).
3. Call `captureConversation` with a `CaptureWorkUnit` carrying provenance.
4. Route the host's memory tool surface through `executeMemoryOperation`.
5. Add boundary tests: no host SDK in the shared path, type-only host imports
   in the adapter.
