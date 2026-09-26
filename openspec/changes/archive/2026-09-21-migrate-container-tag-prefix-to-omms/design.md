# Design: container tag prefix migration to omms

## Context

Phase 4 of `add-pi-adapter-shared-memory` renames the package to `omms` and moves data, config, ids, and logs, but keeps `opencode_` as the on-disk container tag prefix (decision D13 there). This change closes that gap after Phase 4 settles. Grounding facts from the code:

- One config default drives both tag shapes: `opencode_project_<hash>` and `opencode_user_<sha256(email)>` (`src/services/tags.ts`, `CONFIG.containerTagPrefix`, default at `src/config.ts`).
- No source file hardcodes `opencode_project` or `opencode_user`; every surface derives from the config.
- Scope parsing (`extractScopeFromContainerTag`) splits on `_` and takes the scope from the second segment and the hash from the last, so it is prefix-length-agnostic: `omms_project_<hash>` parses identically.
- Shard registration (`metadata.db`, keyed by scope and hash) and shard file names (`projects/project_<hash>_shard_N.db`) do not carry the prefix, so only the `container_tag` column in memory rows needs rewriting.
- Vector search filters rows by the exact `container_tag` value, which is why a mixed-prefix store would split the namespace and why the rewrite must complete before the new default serves traffic.
- Portability import re-derives tags from the current project, so pre-migration export archives remain importable (verified in tasks).
- Provenance metadata, user profiles, and the import ledger do not store the prefix.

## Goals

- Every stored row carries the `omms_` prefix; the default is `omms`.
- Zero data loss, verified; full backup before any rewrite; rollback by restore.
- No mixed-prefix namespace is ever observable to a reader or writer.
- Idempotent, resumable, loud on failure.

## Non-Goals

- Changing tag derivation, hashing, or scope semantics.
- Migrating anything other than the `container_tag` column.
- Supporting running hosts concurrently during the rewrite (single-flight startup guard; the cross-process write lock already serialises writers).

## Decisions

### D1 — Rewrite is a SQL UPDATE, not row-by-row copies

`UPDATE memories SET container_tag = 'omms_' || substr(container_tag, length('opencode_') + 1) WHERE container_tag LIKE 'opencode\_%' ESCAPE '\\'` inside the shard's write transaction, guarded by the existing per-scope cross-process write lock. Vectors never leave the file; the F32_BLOB columns are untouched by an UPDATE that does not reference them.

### D2 — Startup gate, single flight, loud abort

On store initialisation, before any read or write is served: if the completion marker is absent, scan shards for `opencode_` rows; if any exist, run backup then rewrite then verify, then write the marker. Failure aborts initialisation with the failure surfaced to the host (matching the loud-failure convention in this codebase). No silent fallback to dual-prefix reads: a mixed store is a bug state, and hiding it would manufacture the exact data-loss class this migration exists to prevent.

### D3 — Verification invariants, per shard

Before: count of `opencode_` rows, full id set. After: count of `omms_` rows equal to the before-count, zero remaining `opencode_` rows, id set identical. Any mismatch rolls the shard back (the transaction is still open) and aborts the run.

### D4 — Backup and rollback reuse the Phase 4 pattern

Timestamped directory copy of the whole store with a checksum manifest, created and verified before the first rewrite; never deleted or modified by the migration. Rollback is documented as restore-from-backup plus optionally setting `containerTagPrefix: "opencode"` (which then matches the restored rows).

### D5 — Marker and progress live in the store

A marker table in `metadata.db` (or a marker file beside it, decided at implementation for transactional fit) records per-shard progress and store-level completion, so the state travels with the data directory, matching the import ledger's portability rule.

### D6 — Config override warning

If `containerTagPrefix` is explicitly configured as `opencode` after migration, warn once at startup: the override matches no rows; remove it or roll back via backup restore.

## Failure and Safety Rules

- Backup verification failure: abort, no rewrite.
- Shard verification failure: roll back that shard's transaction, abort, report the shard; next run resumes.
- Marker present and no `opencode_` rows: no-op.
- The migration never deletes or rewrites the backup or the pre-migration state.
- The rewrite runs under the existing cross-process write lock; concurrent hosts wait or fail loudly, never interleave.

## Questions to Resolve Before Implementation

1. Marker placement: a `schema_migrations`-style table in `metadata.db` versus a marker file beside it. Table wins if it can share the backup/verify transaction story cleanly.
2. Whether the startup gate runs in every host entry (OpenCode plugin init, Pi session_start) or once per store via a lock file; prefer the simplest single-flight that cannot be bypassed by a second process.

## Resolved Decisions (task 1.2)

### R1 — Marker placement: tables, not files

**Per-shard progress** lives in the shard's own `shard_metadata` table (created by
`initShardDb` in `src/services/turso/shard-manager.ts` for every shard, schema
`key TEXT PRIMARY KEY, value TEXT NOT NULL`). The completion record is written
inside the SAME write transaction as the rewrite, so the marker commits exactly
when the rewrite commits: a rolled-back shard never carries a marker, and a
committed marker always implies the verified rewrite. Key:
`tag_prefix_migration`.

**Store-level completion** lives in a `tag_prefix_migration` table inside
`metadata.db`. Evidence:

- `metadata.db` is the store's registry (the `shards` table); the ready gate
  already opens it lazily through the shared connection manager
  (`tursoShardManager.getAllShards` in `ensureTursoReady`), so reading and writing
  the marker reuses the existing connection and transaction story with no new
  file-format conventions.
- It lives inside `storagePath`, so the marker travels with the data directory —
  the same portability rule the Pi import ledger applied when it chose
  store-internal durable state (`src/importer/ledger.ts`).
- It is included in the whole-store backup by construction.

A marker file beside `metadata.db` would also be crash-safe here (the scan, not
the marker, is the source of truth; see idempotency below), but the table shares
the transaction story cleanly. Table wins, per the stated criterion.

Idempotency rule: the marker is a cache of "scan found zero `opencode_` rows".
If the marker is absent and the scan still finds zero `opencode_` rows (fresh
store, or a crash between the last shard commit and the marker write), the gate
writes the marker and completes without rewriting anything.

### R2 — Single-flight: gate inside `ensureTursoReady` plus a store-level PID-liveness lock file

**Gate placement.** The gate runs at the top of the `ensureTursoReady()` init
promise (`src/services/turso/ready.ts`), after `runLegacyTursoMigration` and
before any shard work. Evidence: every read/write surface funnels through
`ensureTursoReady` — `client.ts` storage init, every web API handler,
`shard-inventory-service`, `cleanup-service`, `deduplication-service`, and the
warmup paths of both hosts (OpenCode plugin init, Pi `session_start`, the Pi
import command). Running the gate there is the one placement every host entry
already passes through, so it cannot be bypassed by a second entry point, and
the ready gate's existing `initPromise` memoisation gives in-process
single-flight for free.

**Cross-process single-flight.** The whole migration (scan → backup → rewrite →
marker) holds a store-level advisory lock file,
`<storagePath>/.tag-prefix-migration.lock`, using the PID-liveness pattern
already proven twice in this codebase (`acquireMigrationLock` in
`src/services/legacy-migration.ts`, `readLiveLock` in
`src/services/turso/cross-process-write-lock.ts`): create with `writeFileSync`
flag `wx`, detect a crashed holder via `kill(pid, 0)`, remove stale locks. A
concurrent second host polls; once the holder releases (or is detected dead) it
re-reads the completion marker: present → no-op; absent → it runs the migration
itself. Acquisition fails loudly after a bounded wait (10 minutes) so a wedged
but live holder can never deadlock every host permanently.

**Per-shard writes.** Each shard rewrite runs under the existing
`tursoShardManager.withScopeWriteLock` (in-process queue + per-scope
`withCrossProcessWriteLock`), so the rewrite can never interleave with a normal
writer from either host even while the gate lock is held.

**Ordering against the directory migration.** The directory migration
(`initConfigWithLegacyMigration`) runs at host init and produces the final
`~/.omms/data` store; the tag gate runs later at storage readiness against that
store. A real first omms start therefore chains directory migration → tag gate,
which is the order the rehearsal replays.

**Test kill-switch.** `OMMS_SKIP_TAG_PREFIX_MIGRATION=1` disables the startup
gate, mirroring `OMMS_SKIP_LEGACY_MIGRATION`; `tests/preload.ts` sets it so
`bun test` can never run the gate against the developer's real store. The core
migration function takes an explicit store path and is unit-tested directly
against temp stores, bypassing the switch by design.

**Backup location.** `<dirname(storagePath)>/backups/tag-prefix-<timestamp>/` —
for the default layout that is `~/.omms/backups/tag-prefix-<ts>/`, beside the
directory migration's `~/.omms/backups/opencode-mem-<ts>/`. Never inside the
store itself (a backup inside the copied tree would recurse and would put
backup data on the store's operational surface). The backup reuses the Phase 4
verified-copy pattern (`copyTreeWithVerification` + `manifest.json`), is
verified before the first rewrite, and is never deleted or modified.
