## Why

The omms identity change (Phase 4 of `add-pi-adapter-shared-memory`) moves the package, default store, config, plugin ids, and logs to `omms`, but deliberately keeps the `opencode_` container tag prefix as the on-disk format: rewriting `container_tag` in every memory row across every shard is real data risk, so it was excluded from that change's blast radius.

The result is an identity gap: the storage format still carries the upstream-derived name forever, and the fork's data layout never fully becomes its own. That is acceptable as a transitional state and unacceptable as a permanent one. Once Phase 4 ships and settles, the prefix should move to `omms_` in one deliberate, verified, backup-first migration, so future memories carry the fork's identity end to end.

## What Changes

- Add a one-time container tag prefix migration: rewrite every memory row's `container_tag` across all project and user shards from `opencode_<scope>_<hash>` to `omms_<scope>_<hash>`, in a per-shard transaction, after creating a checksum-verified backup of the store.
- Flip the `containerTagPrefix` default from `opencode` to `omms` only in the same release, sequenced so new writes can never produce a mixed-prefix namespace.
- Migration is idempotent and resumable: a marker (per store) records completion; partial shard failures resume on the next run; a completed migration is a no-op.
- Verification invariants per shard: row count unchanged, memory id set unchanged, count of `opencode_` rows before equals count of `omms_` rows after, vectors and metadata untouched.
- Rollback: restore from the backup taken before the rewrite. The migration never deletes the backup or the pre-migration state.
- Timing gate: this change only lands after the `add-pi-adapter-shared-memory` change (including Phase 4) is complete and settled.

## Capabilities

### New Capabilities

- `omms-tag-prefix-migration`: safe, verified, backup-first migration of stored container tags from the `opencode_` prefix to `omms_`, with the default prefix flip sequenced against it.

### Modified Capabilities

None. The storage-format capability is specified through `add-pi-adapter-shared-memory`'s `host-neutral-memory-core` delta; this change adds its own capability rather than modifying that active change.

## Impact

- Storage layer: a new migration step over every shard file (memories rows only; `metadata.db` shard registrations are keyed by scope and hash, which the prefix change does not alter; shard file names do not carry the prefix).
- Config: `containerTagPrefix` default flips to `omms`; users who explicitly set `containerTagPrefix: "opencode"` keep their override and are warned that their rows were migrated to `omms_` (override should be removed; the migration report surfaces this).
- Portability: export archives created before this change contain `opencode_` tags; import re-derives tags from the current project, so imports remain valid (verified during implementation).
- Provenance, vectors, user profiles, and the import ledger are untouched: none store the prefix.
