# Tasks: Migrate Container Tag Prefix to omms

> Timing gate: do not start this change until `add-pi-adapter-shared-memory` (including Phase 4) is complete and settled.

## 1. Surface inventory and migration module

- [ ] 1.1 Verify the surface inventory against the code and add tests pinning it: one config default builds `opencode_project_<hash>` and `opencode_user_<sha256(email)>`; scope parsing is prefix-agnostic; shard registration and file names carry no prefix; portability import re-derives tags; profiles, provenance, and the import ledger store no prefix.
- [ ] 1.2 Resolve design question 1 (marker placement in `metadata.db` versus a marker file) and question 2 (single-flight startup gate mechanics) with evidence, recording the outcome in design.md.
- [ ] 1.3 Implement the backup step reusing the Phase 4 verified-backup pattern (timestamped store copy plus checksum manifest, verified before any rewrite, never deleted or modified).
- [ ] 1.4 Implement the per-shard rewrite: `opencode_` to `omms_` prefix UPDATE inside the shard's write transaction under the existing cross-process write lock, with per-shard before/after verification (row counts, id sets, zero remaining `opencode_` rows) and rollback of the shard on invariant failure.
- [ ] 1.5 Implement idempotency and resume: store-level completion marker plus per-shard progress; completed migrations are no-ops; interrupted runs resume on remaining shards only.

## 2. Sequencing, config, and startup gate

- [ ] 2.1 Implement the startup gate: before serving any read or write, if unmigrated `opencode_` rows exist, run the migration to completion; on failure abort loudly with the failure surfaced to the host; no silent dual-prefix fallback.
- [ ] 2.2 Flip the `containerTagPrefix` default to `omms` in the same release, sequenced so no write can use the new default while `opencode_` rows remain unmigrated.
- [ ] 2.3 Warn once at startup when configuration explicitly sets `containerTagPrefix` to `opencode` after migration (override matches no rows).

## 3. Tests

- [ ] 3.1 Shard rewrite correctness against a real temp store: mixed project/user shards rewrite to `omms_`, vectors and metadata byte-identical, invariants hold.
- [ ] 3.2 Idempotency: rerun after completion is a no-op; interrupted run resumes remaining shards without duplicating or skipping.
- [ ] 3.3 Safety: backup failure aborts with nothing rewritten; shard verification failure rolls back that shard and aborts; the backup and pre-migration state are never modified.
- [ ] 3.4 Sequencing: fresh-open with unmigrated rows runs the gate before serving; post-migration search and capture (both hosts) work against `omms_` rows; a `containerTagPrefix: "opencode"` override triggers the warning.
- [ ] 3.5 Portability: a pre-migration export archive (with `opencode_` tags) still imports under the new prefix.

## 4. Documentation and gates

- [ ] 4.1 Extend `docs/omms-migration.md` with the tag prefix migration: invariants, backup, resume, rollback by restore, and the config-override warning.
- [ ] 4.2 Run the full repository test/check/build suite and `openspec validate --all --strict`.
