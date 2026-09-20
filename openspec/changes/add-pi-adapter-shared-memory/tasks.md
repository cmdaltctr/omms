# Tasks: Add Pi Adapter with Shared Memory

> Implement in three phases. Do not start a later phase until the previous phase has parity/compatibility tests passing.

## 1. Shared core extraction + OpenCode parity

- [x] 1.1 Add characterization tests for current OpenCode memory add/search/list/forget/profile, auto-capture, compaction injection, portability, cleanup, and web-backend behavior.
- [x] 1.2 Define host-neutral types for project identity, memory operations, capture work units, structured extraction results, notifications, and provenance.
- [x] 1.3 Refactor automatic capture so the extraction/persistence pipeline accepts a normalized work unit instead of OpenCode `PluginInput`.
- [x] 1.4 Extract provider access behind a narrow structured-extraction interface while preserving the current OpenCode provider path and configured fallback providers.
- [x] 1.5 Extract reusable memory-tool operations from the OpenCode tool wrapper so host adapters call the same service functions.
- [x] 1.6 Reuse the existing privacy, deduplication, embedding, Turso/libSQL, retrieval, project identity, user-profile, cleanup, portability, and web-backend services rather than duplicating them.
- [x] 1.7 Add backward-compatible host/source provenance support without invalidating existing memory rows.
- [x] 1.8 Preserve `~/.opencode-mem/data`, current project tag derivation, and the default `opencode` tag prefix.
- [x] 1.9 Keep `src/index.ts` and the current `src/v2/adapter.ts` as OpenCode compatibility surfaces while routing their reusable work through the shared core.
- [x] 1.10 Add a two-process storage test for concurrent initialization, same-project writes, read-after-write, close/reopen, and shard allocation/rollover where practical.
- [x] 1.11 If 1.10 demonstrates races, add the smallest cross-process coordination required around affected Turso/libSQL metadata or shard operations; do not add a new storage engine.
- [x] 1.12 Make shared runtime/web lifecycle start/stop callable without OpenCode TUI dependencies while preserving existing web owner/takeover behavior.
- [x] 1.13 Run existing tests plus new OpenCode parity tests, typecheck, lint, and build; fix extraction regressions before Phase 2.
- [x] 1.14 Document the shared-core boundary and the compatibility guarantee for existing OpenCode data.

## 2. Pi adapter

- [x] 2.1 Add a Pi extension entry point in the existing package; do not create a monorepo.
- [x] 2.2 Follow current Pi package conventions for extension discovery and peer/development dependencies so a second Pi runtime is not bundled.
- [x] 2.3 Resolve Pi `ctx.cwd` through the same shared project-root/project-identity/tag functions used by OpenCode.
- [x] 2.4 Implement `before_agent_start` semantic retrieval using the current prompt and project memory.
- [x] 2.5 Inject bounded memory/profile context through a named Pi structured prompt section or equivalent supported pre-agent surface; do not create a fake user message or replace the full prompt unnecessarily.
- [x] 2.6 Implement `agent_settled` as the primary automatic-capture trigger; do not use `agent_end` as the main boundary.
- [x] 2.7 Build the newly settled work unit from `ctx.sessionManager` active-branch entries and exclude hidden thinking/reasoning content.
- [x] 2.8 Define a stable live source identity from Pi session/source entry IDs and prevent repeated settled events from recapturing the same work unit.
- [x] 2.9 Implement the Pi extraction/profile provider bridge with `ctx.model`, `ctx.modelRegistry`, and current provider-aware model-call APIs such as `streamSimple()`; validate structured results with the shared schema.
- [x] 2.10 Ensure extraction/profile failure does not disable local manual memory operations.
- [x] 2.11 Register the Pi-native `memory` tool as a thin adapter over the shared add/search/profile/list/forget/help and applicable portability operations.
- [x] 2.12 Persist Pi live provenance including host, session ID, source type, source entry IDs, and timestamps where available.
- [x] 2.13 Handle Pi compaction conservatively: preserve capture/injection continuity without replacing native compaction summarization by default.
- [x] 2.14 Test overflow/automatic compaction followed by retry and `agent_settled`; verify exactly one capture for the settled work unit.
- [x] 2.15 Close session-scoped resources on `session_shutdown` and make cleanup idempotent across quit, reload, new, resume, and fork flows.
- [x] 2.16 Verify Pi and OpenCode can run in separate processes against the same store without corrupting shard metadata or losing writes.
- [x] 2.17 Add cross-host integration tests: write in Pi/read in OpenCode and write in OpenCode/read in Pi for the same project.
- [x] 2.18 Document Pi installation, configuration, lifecycle mapping, model-selection behavior, and shared-store expectations.

## 3. Pi historical-session backfill

- [x] 3.1 Implement explicit Pi-session discovery under Pi's configured/default session root without modifying source files.
- [x] 3.2 Load known sessions with Pi's exported session model, preferring `SessionManager.open()` and public entry/header types over a custom JSONL parser.
- [x] 3.3 Use `parseSessionEntries()` and `migrateSessionEntries()` only where useful for supported compatibility/discovery/fixtures; pin and test the supported Pi API version range.
- [x] 3.4 Read the Pi session header and recorded `cwd`; resolve the same shared project identity used by live Pi/OpenCode capture.
- [x] 3.5 Select only the session's active/current branch initially using Pi branch/context APIs; exclude abandoned branches.
- [x] 3.6 Reconstruct useful user â assistant/tool work units with stable source entry IDs and source timestamps.
- [x] 3.7 Strip hidden thinking/reasoning and provider-only reasoning metadata before work units reach privacy filtering or extraction.
- [x] 3.8 Apply the same bounded tool/text normalization as live capture.
- [x] 3.9 Define a deterministic import identity from Pi session/source entry identity; do not use embedding similarity as the import key.
- [x] 3.10 Persist provenance for history imports: host, Pi session ID, source JSONL, source entry IDs, timestamps, source type, and import identity.
- [x] 3.11 Add a durable import ledger with states sufficient to distinguish pending/in-progress, imported, skipped, and failed/retryable work where applicable; keep the ledger inside `storagePath` so idempotency travels with the store on machine moves.
- [x] 3.12 Make persistence crash-safe: use one transaction when memory and ledger can share it, otherwise reconcile incomplete ledger entries against exact stored import identity before reinserting.
- [x] 3.13 Route imported work through the same privacy â extraction â deduplication â embedding â persistence pipeline as live capture.
- [x] 3.14 Record terminal handled state for deterministic extractor `skip` results where appropriate so reruns do not repeatedly spend model calls.
- [x] 3.15 Add dry-run that performs discovery, filtering, project mapping, candidate identity, and existing-state checks but performs no extraction call, embedding, memory write, ledger write, or source write.
- [x] 3.16 Support current-project and all-projects scope filters.
- [x] 3.17 Support exact session and inclusive date-range filters with documented timestamp semantics.
- [x] 3.18 Ensure filtering happens before expensive extraction and embedding work.
- [x] 3.19 Add fixtures for current and supported legacy Pi session versions, compaction, forks/branches, malformed entries, tool calls/results, and hidden thinking.
- [x] 3.20 Add idempotency tests for first import, second import, partial failure, memory-inserted/ledger-incomplete crash recovery, and skipped units.
- [x] 3.21 Add a read-only safety test that hashes source JSONL files before and after dry-run, successful import, failed import, and rerun.
- [x] 3.22 Add end-to-end backfill tests showing an imported Pi memory is retrievable from both Pi and OpenCode for the mapped project.
- [x] 3.23 Document importer usage, filters, provenance, dry-run guarantees, recovery behavior, and how to inspect import status; include the machine-move procedure (copy the data directory plus config, remap project paths with `memory migrate` when the absolute path changes, and keep the embedding model identical).
- [x] 3.24 Run the full repository test/check/build suite and `openspec validate --all --strict`.
- [x] 3.25 Expose the importer as a Pi command in the extension (dry-run, filters, and mapping as arguments, with progress reporting) running over the shared importer service; extraction inherits the active Pi model or the `piProvider`/`piModel` override. A headless bin CLI stays deferred until a direct-provider use case exists.
- [x] 3.26 Skip sessions whose recorded `cwd` no longer resolves (deleted worktrees, removed directories), report them in dry-run output, and support explicit `--map <oldPath>=<newPath>` remapping so their work units import into the mapped project namespace, matching what live capture would have resolved.

## 4. omms identity and legacy migration

- [x] 4.1 Rename the package to `omms` (version 3.0.0, description, keywords, author) and retitle README plus docs to Opinionated Modular Memory System with `npm:omms` install instructions for both hosts.
- [x] 4.2 Make `~/.omms/data` the default store and `~/.config/omms/omms.jsonc` the primary config, with dual-read fallback to the legacy `~/.config/opencode/opencode-mem.jsonc` only when the new file does not exist; the legacy config is never written.
- [x] 4.3 Implement the one-time migration module: before any copy, create a timestamped backup of the entire `~/.opencode-mem` directory with a checksum manifest; then copy (never move) the store to `~/.omms/data`, verify every file against its source checksum, and write a marker recording source, destination, backup path, file count, and timestamp; reruns with the marker present are no-ops.
- [x] 4.4 Abort the migration whenever the backup or any per-file verification fails; the system keeps resolving storage against the legacy layout and the legacy directory stays untouched.
- [x] 4.5 Never delete or modify the legacy directory; document rollback as pointing `storagePath` at the original or restoring the backup.
- [x] 4.6 Move runtime identity to omms: plugin id `omms` in the v1/v2 entries (update loader-contract tests), default log file `~/.omms/omms.log` with `OMMS_LOG_FILE` override (`OPENCODE_MEM_LOG_FILE` still honoured as legacy), and omms-prefixed log archives.
- [x] 4.7 Keep the `opencode_` container tag prefix as the on-disk format (no memory row is rewritten); document it as the historical format name, still configurable via `containerTagPrefix`.
- [ ] 4.8 Add migration tests against temp stores: legacy layout migrates with matching checksums, marker, and untouched original; idempotent rerun; backup failure aborts with nothing migrated; corrupted source file aborts; dual-read precedence; fresh install starts at the new paths with no migration artefacts.
- [x] 4.9 Document the migration, backup, and rollback procedure in `docs/omms-migration.md` and link it from the README fork notice.
- [ ] 4.10 Run the full repository test/check/build suite and `openspec validate --all --strict`.
