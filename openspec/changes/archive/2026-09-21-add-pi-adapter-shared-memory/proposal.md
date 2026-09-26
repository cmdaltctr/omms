## Why

`opencode-mem` already contains a mature local memory engine: Turso/libSQL storage, vector retrieval, embeddings, deduplication, privacy filtering, project identity, user profiles, cleanup, portability, capture/extraction, and a web/API surface. The main runtime wiring is still OpenCode-specific.

Current Pi extension APIs provide the lifecycle surfaces needed to reuse that engine: `before_agent_start`, `agent_settled`, compaction events, `session_shutdown`, custom tools, a read-only session manager, and model/model-credential access through `ctx.modelRegistry`. Pi's package scope and extension APIs have changed across releases, so implementation must pin and verify the current Pi version instead of assuming stale package names or import paths.

The user also has existing Pi JSONL history. A live adapter alone would start with an empty Pi-derived history, so this change also defines a safe, idempotent backfill path into the same shared memory store.

## What Changes

### Host-neutral shared memory core

- Separate host lifecycle/session/UI concerns from reusable memory services.
- Keep Turso/libSQL storage, vector search, embeddings, deduplication, privacy, project identity, profiles, cleanup, portability, retrieval/persistence, web/backend services, and capture/extraction reusable.
- Replace OpenCode-native capture inputs with a normalized host-neutral conversation/capture contract.
- Keep one repository/package for now; do not force a monorepo rewrite.
- Preserve existing OpenCode behavior and existing memory data compatibility.

### OpenCode remains a first-class adapter

- Preserve the existing OpenCode entry point and memory tool behavior.
- Preserve `~/.opencode-mem/data`, current shard/container tag semantics, vector behavior, and migration compatibility.
- Keep the current OpenCode structured-output/provider path behind the host-neutral provider interface.
- Do not rename the storage namespace or require re-embedding solely for this change.

### Pi coding-agent adapter

- Add a Pi extension entry point.
- Use `before_agent_start` for prompt-aware semantic retrieval and bounded memory/profile injection, preferably through Pi's structured prompt-section surface rather than a fake user turn or wholesale prompt replacement.
- Use `agent_settled`, not `agent_end`, as the normal automatic-capture boundary.
- Integrate `session_before_compact` / `session_compact` without fake user turns.
- Expose shared memory operations through Pi's extension tool/command surfaces where appropriate.
- Resolve Pi models/credentials and run internal extraction/profile learning through the pinned Pi release's public `ctx.modelRegistry` facade. In the verified Pi 0.85.1 API, `ModelRegistry` exposes `find()`, `complete()`, `stream()`, and credential helpers.
- Reuse the existing project identity logic so the same project maps to the same store from OpenCode and Pi.
- Clean up database/web resources on shutdown.

### Cross-host provenance

New memories support provenance such as host, host session ID, source type, source entry IDs, and source timestamp. Provenance is metadata, not namespace isolation: matching project/scope memory remains retrievable across hosts.

### Pi historical-session backfill

- Discover Pi sessions under `~/.pi/agent/sessions/**/*.jsonl` by default.
- Prefer Pi's current exported session APIs, including `SessionManager.open()`, `parseSessionEntries()`, and `migrateSessionEntries()`. Pin/test the supported Pi release rather than copying Pi's JSONL grammar or importing private source paths.
- Read recorded session ID and `cwd`, then resolve the same project identity used by live capture.
- Prefer the active/current branch initially.
- Reconstruct useful user -> assistant/tool work units while excluding hidden reasoning/thinking, system-only state, and binary/image payloads from memory text.
- Reuse the live privacy -> extraction/classification -> deduplication -> embedding -> persistence pipeline.
- Preserve `host=pi`, Pi session ID, source JSONL, source entry IDs, timestamps, and `source=history-import`.
- Use a durable deterministic import identity/ledger so reruns are idempotent and crash recovery cannot duplicate a memory.
- Support `--dry-run`, current-project/all-projects/session/date filters, and explicit reprocess behavior.
- Never modify, migrate in place, rename, truncate, or delete Pi's source JSONL files.

## Delivery Phases

1. **Shared core extraction + OpenCode parity**
2. **Pi adapter**
3. **Pi historical-session backfill**
4. **omms identity and legacy migration**

## Phase 4: omms identity and legacy migration

The fork publishes under its own identity: `omms`, the Opinionated Modular Memory System. Upstream owns the `opencode-mem` name on npm, so a distinct package name is required for npm distribution to both hosts. Identity separation is complete, not cosmetic: package name, default store (`~/.omms/data`), config (`~/.config/omms/omms.jsonc`), plugin ids, and log files all move to `omms`.

Existing opencode-mem data migrates through an explicit migration module with safety as the first rule: a verified timestamped backup of the entire legacy directory is created before anything is copied; the migration copies (never moves) the store to the new location, verifies every file with checksums, and writes a migration marker; the legacy directory is never modified or deleted, and rollback is pointing `storagePath` at the original or restoring the backup. Fresh installs start directly at the new paths. The `opencode_` container tag prefix remains the on-disk format so no memory row is rewritten; it stays configurable via `containerTagPrefix`.

## Capabilities

### New Capabilities

- `host-neutral-memory-core`
- `pi-agent-adapter`
- `pi-session-history-backfill`

### Modified Capabilities

None. This fork has no OpenSpec baseline for current OpenCode behavior, so compatibility is specified through this change and its tests.

## Impact

The main OpenCode wiring in `src/index.ts` and existing `src/services/*` engine will gain explicit host boundaries. Relevant existing services include auto-capture, embeddings, deduplication, privacy, tags/project identity, portability, cleanup/migration, and web/API services. The repository also already has `src/v2/adapter.ts`; that compatibility adapter must not be conflated with the new host-adapter boundary.

Existing data stays in place. Pi-specific configuration is additive. OpenCode and Pi may access the same local store, so existing write-lock/migration protections must be verified for cross-process use.

Verification includes OpenCode parity, pre-change data compatibility, cross-host retrieval in both directions, Pi settled-boundary capture, Pi compaction continuity, importer idempotency/crash recovery, dry-run no-write behavior, malformed-session tolerance, and byte-for-byte source-session integrity.
