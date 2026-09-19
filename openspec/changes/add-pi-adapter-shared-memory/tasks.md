# Tasks: add-pi-adapter-shared-memory

## 1. Phase 1 — Shared core extraction + OpenCode parity

- [ ] 1.1 Add host-neutral types for conversation snapshots, capture provenance, provider access, notifications, and project context.
- [ ] 1.2 Refactor auto-capture so the shared pipeline no longer accepts OpenCode `PluginInput`.
- [ ] 1.3 Move OpenCode message/session collection and TUI notifications into the OpenCode adapter boundary.
- [ ] 1.4 Wrap the existing OpenCode structured-output/provider path behind the shared extraction-provider interface.
- [ ] 1.5 Extract reusable memory operations from the OpenCode-specific tool wrapper.
- [ ] 1.6 Preserve current Turso/libSQL shard format, storage path, project tags, vector behavior, and migration compatibility.
- [ ] 1.7 Add provenance to new memories without requiring existing rows to be rewritten.
- [ ] 1.8 Add dependency-boundary tests proving shared core/services import neither OpenCode nor Pi SDK types.
- [ ] 1.9 Add OpenCode parity tests for retrieval/injection, manual memory operations, auto-capture, profiles, compaction, web/API startup, and cleanup.
- [ ] 1.10 Add a compatibility fixture that opens a pre-change memory data directory and verifies existing memories remain readable/searchable.

## 2. Phase 2 — Pi adapter

- [ ] 2.1 Pin and document the current Pi coding-agent package/version and public extension/session APIs; do not assume a stale package scope.
- [ ] 2.2 Add the Pi extension entry point without converting the repository into a monorepo.
- [ ] 2.3 Resolve Pi project context through the existing shared project identity/tag logic.
- [ ] 2.4 Implement `before_agent_start` semantic retrieval using the incoming prompt.
- [ ] 2.5 Inject bounded project memory plus user-profile context through Pi's supported pre-agent context surface.
- [ ] 2.6 Implement `agent_settled` live capture from the current Pi branch; do not use `agent_end` as the primary auto-capture boundary.
- [ ] 2.7 Implement a Pi structured-memory provider that resolves model/credentials through `ctx.modelRegistry` and calls the pinned release's supported Pi AI generation API.
- [ ] 2.8 Support active/inherit and explicit Pi model modes, retaining the existing direct provider path as fallback.
- [ ] 2.9 Register Pi memory search/add/list/profile/forget behavior through tools/commands where semantically appropriate.
- [ ] 2.10 Persist Pi host/session/entry/timestamp provenance.
- [ ] 2.11 Integrate `session_before_compact` / `session_compact` without fake user turns.
- [ ] 2.12 Add `session_shutdown` cleanup for database and web/backend resources.
- [ ] 2.13 Keep Pi notifications/UI adapter-local.
- [ ] 2.14 Verify simultaneous OpenCode/Pi access to the same local store and define retry/single-writer behavior if current locking is insufficient.
- [ ] 2.15 Add E2E: OpenCode-created memory is retrievable from Pi.
- [ ] 2.16 Add E2E: Pi-created memory is retrievable from OpenCode.

## 3. Phase 3 — Pi historical-session backfill

- [ ] 3.1 Add configurable Pi session root, default `~/.pi/agent/sessions`.
- [ ] 3.2 Discover JSONL session files recursively without modifying them.
- [ ] 3.3 Reuse Pi's supported public session APIs. Prefer `SessionManager.open()`; use `parseSessionEntries()` / `migrateSessionEntries()` only if public in the pinned version. Never import Pi private source paths or implement an independent JSONL grammar.
- [ ] 3.4 Read session ID and recorded `cwd`; resolve the same project identity as live capture.
- [ ] 3.5 Resolve the active/current branch and construct historical user/assistant/tool work units.
- [ ] 3.6 Exclude system-only state, hidden reasoning/thinking, image/binary payloads, and extension-only state from memory text.
- [ ] 3.7 Generate a stable deterministic import key from Pi session and source entry IDs.
- [ ] 3.8 Add a durable import ledger with imported/skipped/failed/reconciled states.
- [ ] 3.9 Reconcile the crash window where memory exists but ledger completion did not commit.
- [ ] 3.10 Send history through the same privacy, extraction/classification, deduplication, embedding, and persistence pipeline as live capture.
- [ ] 3.11 Add `history-import` provenance: source file, session ID, entry IDs, timestamps, and import key.
- [ ] 3.12 Implement `--dry-run` with zero extraction-model, embedding, vector, memory, source-session, or ledger writes.
- [ ] 3.13 Add current-project, all-projects, session-ID, date-range, and maximum-session filters.
- [ ] 3.14 Add explicit force/reprocess behavior; never silently reprocess successful keys.
- [ ] 3.15 Add fixtures covering supported legacy/current Pi session versions through Pi's own migration path.
- [ ] 3.16 Test branching sessions; default import uses the active/current branch only.
- [ ] 3.17 Test malformed/truncated JSONL isolation.
- [ ] 3.18 Test idempotency by running the same import twice.
- [ ] 3.19 Hash source Pi files before/after import and assert byte-for-byte integrity.
- [ ] 3.20 Add E2E: an imported Pi decision is retrievable from both Pi and OpenCode.

## 4. Documentation and verification

- [ ] 4.1 Document core-versus-adapter architecture and lifecycle mapping.
- [ ] 4.2 Document shared storage semantics and cross-host provenance.
- [ ] 4.3 Document Pi installation, pinned dependency, and provider configuration.
- [ ] 4.4 Document Pi-history dry-run, filters, retry/reprocess, and recovery behavior.
- [ ] 4.5 Document that history import is opt-in and source JSONL is immutable.
- [ ] 4.6 Run the existing and new test suites.
- [ ] 4.7 Run typecheck/build for OpenCode and Pi entry points.
- [ ] 4.8 Run `openspec validate --all --strict`.
