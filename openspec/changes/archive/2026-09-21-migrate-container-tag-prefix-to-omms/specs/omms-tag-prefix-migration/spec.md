# omms-tag-prefix-migration Specification

## Purpose

Safe, verified, backup-first migration of stored container tags from the `opencode_` prefix to `omms_`, sequenced with the `containerTagPrefix` default flip so the store never serves a mixed-prefix namespace.

## ADDED Requirements

### Requirement: Tag rewrite is verified and transactional per shard

The migration SHALL rewrite every memory row's `container_tag` from `opencode_<scope>_<hash>` to `omms_<scope>_<hash>` in a per-shard transaction, and SHALL verify per shard that the row count is unchanged, the memory id set is unchanged, and the number of rewritten rows equals the number of `opencode_` rows observed before the rewrite.

#### Scenario: A shard rewrites cleanly

- **WHEN** the migration processes a shard containing `opencode_`-prefixed rows
- **THEN** all such rows SHALL be updated to the `omms_` prefix in one transaction
- **AND** vectors, metadata JSON, and all other columns SHALL be byte-identical
- **AND** the pre/post verification SHALL pass before the shard is marked migrated

#### Scenario: Verification fails on a shard

- **WHEN** any per-shard invariant fails after the rewrite
- **THEN** that shard's transaction SHALL be rolled back
- **AND** the migration SHALL abort with a report identifying the shard
- **AND** already-migrated shards SHALL remain valid and the next run SHALL resume from them

### Requirement: A verified backup precedes any rewrite

The migration SHALL create a timestamped, checksum-verified backup of the entire store before rewriting the first shard, and SHALL abort without rewriting anything if the backup cannot be created or verified.

#### Scenario: The backup step fails

- **WHEN** backup creation or its checksum manifest fails
- **THEN** no shard SHALL be rewritten
- **AND** the system SHALL keep operating on the unchanged store

### Requirement: Migration is idempotent and resumable

A per-store marker SHALL record migration completion, and per-shard progress SHALL allow resuming after a partial failure without duplicating work or skipping shards.

#### Scenario: The migration runs again after success

- **WHEN** the marker records a completed migration and no `opencode_` rows remain
- **THEN** the migration SHALL be a no-op

#### Scenario: A previous run was interrupted mid-store

- **WHEN** some shards are migrated and others are not
- **THEN** the next run SHALL migrate only the remaining shards

### Requirement: The default prefix flip never produces a mixed namespace

The `containerTagPrefix` default SHALL become `omms` in the same release as the migration, and the startup order SHALL guarantee no write can occur with the new default while `opencode_` rows remain unmigrated.

#### Scenario: The store is opened for the first time after upgrading

- **WHEN** `opencode_` rows exist and the migration has not completed
- **THEN** the migration SHALL run to completion (or abort loudly) before any memory write or search is served
- **AND** on abort the failure SHALL be surfaced, not silently absorbed

#### Scenario: A user still overrides containerTagPrefix to opencode

- **WHEN** configuration explicitly sets `containerTagPrefix` to `opencode` after the migration
- **THEN** the system SHALL warn that stored rows carry the `omms_` prefix and the override no longer matches any rows

### Requirement: Rollback restores the pre-migration store

Rollback SHALL be restore-from-backup only; the migration SHALL never delete or modify the backup or the pre-migration state it captured.

#### Scenario: The operator restores the backup

- **WHEN** the backup archive is restored over the store directory
- **THEN** all rows SHALL carry `opencode_` prefixes again
- **AND** retrieval under a `containerTagPrefix: "opencode"` override SHALL work as before the migration
