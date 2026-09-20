# Tasks: Migrate Container Tag Prefix to omms

> Timing gate: do not start this change until `add-pi-adapter-shared-memory` (including Phase 4) is complete and settled.

## 1. Surface inventory and migration module

- [x] 1.1 Verify the surface inventory against the code and add tests pinning it: one config default builds `opencode_project_<hash>` and `opencode_user_<sha256(email)>`; scope parsing is prefix-agnostic; shard registration and file names carry no prefix; portability import re-derives tags; profiles, provenance, and the import ledger store no prefix. (tests/tag-prefix-migration.test.ts "surface inventory" describe block: tag shapes for both prefixes, prefix-agnostic parsing, shard path/registry pins, container_tag column exists only in memories tables)
- [x] 1.2 Resolve design question 1 (marker placement in `metadata.db` versus a marker file) and question 2 (single-flight startup gate mechanics) with evidence, recording the outcome in design.md. (design.md "Resolved Decisions (task 1.2)": R1 tables not files (per-shard shard_metadata + store-level tag_prefix_migration table in metadata.db); R2 gate inside ensureTursoReady + store-level PID-liveness lock file; commit ea3db55)
- [x] 1.3 Implement the backup step reusing the Phase 4 verified-backup pattern (timestamped store copy plus checksum manifest, verified before any rewrite, never deleted or modified). (src/services/tag-prefix-migration.ts createVerifiedBackup; copyFilesWithVerification extracted from legacy-migration.ts; scope-group files copied under the per-scope cross-process write lock)
- [x] 1.4 Implement the per-shard rewrite: `opencode_` to `omms_` prefix UPDATE inside the shard's write transaction under the existing cross-process write lock, with per-shard before/after verification (row counts, id sets, zero remaining `opencode_` rows) and rollback of the shard on invariant failure. (rewriteShard in src/services/tag-prefix-migration.ts; rollback verified by the injected-trigger test)
- [x] 1.5 Implement idempotency and resume: store-level completion marker plus per-shard progress; completed migrations are no-ops; interrupted runs resume on remaining shards only. (runTagPrefixMigration in src/services/tag-prefix-migration.ts; not-needed/already-migrated/resume tests)

## 2. Sequencing, config, and startup gate

- [x] 2.1 Implement the startup gate: before serving any read or write, if unmigrated `opencode_` rows exist, run the migration to completion; on failure abort loudly with the failure surfaced to the host; no silent dual-prefix fallback. (runStartupTagPrefixGate wired into ensureTursoReady in src/services/turso/ready.ts; kill switch OMMS_SKIP_TAG_PREFIX_MIGRATION in tests/preload.ts; gate test flips rows via ensureTursoReady)
- [x] 2.2 Flip the `containerTagPrefix` default to `omms` in the same release, sequenced so no write can use the new default while `opencode_` rows remain unmigrated. (DEFAULTS.containerTagPrefix = "omms" in src/config.ts; the gate in ensureTursoReady completes before any memory write is served; default-pinned test expectations updated)
- [x] 2.3 Warn once at startup when configuration explicitly sets `containerTagPrefix` to `opencode` after migration (override matches no rows). (explicitOpencodePrefixWarning + getExplicitContainerTagPrefix; warning emitted from runStartupTagPrefixGate; unit test pins the warning text)

## 3. Tests

- [x] 3.1 Shard rewrite correctness against a real temp store: mixed project/user shards rewrite to `omms_`, vectors and metadata byte-identical, invariants hold. ("rewrites every opencode_ row..." test: hex(vector) and full-column dumps compared; custom_ row untouched)
- [x] 3.2 Idempotency: rerun after completion is a no-op; interrupted run resumes remaining shards without duplicating or skipping. ("rerun after completion is a no-op", "a crash between the last shard rewrite and the marker write", "resumes remaining shards" tests)
- [x] 3.3 Safety: backup failure aborts with nothing rewritten; shard verification failure rolls back that shard and aborts; the backup and pre-migration state are never modified. ("backup failure aborts", "shard verification failure rolls back" tests with injected trigger + blocked backups dir; rollback-restore test proves the backup restores a working opencode_ store)
- [x] 3.4 Sequencing: fresh-open with unmigrated rows runs the gate before serving; post-migration search and capture (both hosts) work against `omms_` rows; a `containerTagPrefix: "opencode"` override triggers the warning. ("startup gate runs before serving" test via resetTursoReady + ensureTursoReady; warning unit test; cross-host-memory tests now run against omms_ rows end to end)
- [x] 3.5 Portability: a pre-migration export archive (with `opencode_` tags) still imports under the new prefix. (tests/tag-prefix-portability.test.ts: child imports a schema-valid archive with opencode_ source tag; stored row carries omms_project_<hash>)

## 4. Documentation and gates

- [x] 4.1 Extend `docs/omms-migration.md` with the tag prefix migration: invariants, backup, resume, rollback by restore, and the config-override warning. (docs/omms-migration.md "Container tag prefix" section rewritten; README.md, docs/pi-adapter.md, docs/shared-core.md prefix references updated; commit 871c49a)
- [x] 4.2 Run the full repository test/check/build suite and `openspec validate --all --strict`. (typecheck PASS, lint PASS, format:check PASS, build PASS, bun test 588 tests 0 fail 4 Windows-only skips, openspec validate --all --strict 2/2 PASS; rehearsal against a copy of the real store: 19 shards, 1626 rows rewritten, all invariants PASS, marker written, idempotent rerun, backup verified untouched)
