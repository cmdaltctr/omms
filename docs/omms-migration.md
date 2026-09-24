# Migrating from opencode-mem to omms

omms is the fork's package identity (upstream owns `opencode-mem` on npm).
From version 3.0.0 the identity is fully separated:

| What                 | Legacy (opencode-mem)                    | omms                                                      |
| -------------------- | ---------------------------------------- | --------------------------------------------------------- |
| Package              | `opencode-mem`                           | `omms`                                                    |
| Default store        | `~/.opencode-mem/data`                   | `~/.omms/data`                                            |
| Primary config       | `~/.config/opencode/opencode-mem.jsonc`  | `~/.config/omms/omms.jsonc`                               |
| Plugin id            | `opencode-mem`                           | `omms`                                                    |
| Log file             | `~/.opencode-mem/opencode-mem.log`       | `~/.omms/omms.log`                                        |
| Container tag prefix | `opencode_project_<hash>`                | `omms_project_<hash>` (migrated automatically, see below) |
| Project config       | `<project>/.opencode/opencode-mem.jsonc` | `<project>/.opencode/omms.jsonc` (legacy still read)      |
| Project marker       | `.opencode-mem-project`                  | `.omms-project` (legacy still honoured)                   |
| API token header     | `X-Opencode-Mem-Token`                   | `X-Omms-Token` (legacy still accepted)                    |
| Web UI token file    | `~/.opencode-mem/.auth-token`            | `~/.omms/.auth-token` (legacy token adopted once)         |
| Retrieval section    | `<opencode-mem-retrieval>`               | `<omms-retrieval>`                                        |

## What happens automatically

On the first start after upgrading, if `~/.opencode-mem/data` exists and
`~/.omms/data` does not, omms runs a one-time migration:

1. **Backup.** A timestamped, checksum-verified backup of the ENTIRE
   `~/.opencode-mem` directory is created at
   `~/.omms/backups/opencode-mem-<timestamp>/`, with a `manifest.json`
   recording every file's size and SHA-256. The backup is verified before
   anything else happens.
2. **Copy.** The store is COPIED to `~/.omms/data`. Every copied file is
   checksum-verified against its source. The legacy directory is never moved,
   renamed, modified, or deleted.
3. **Marker.** `~/.omms/migration-marker.json` records the source,
   destination, backup path, file count, and timestamps. Any later start sees
   the marker and does nothing.

If the backup or any file verification fails, the migration aborts
immediately, writes a marker with `status: "failed"`, and storage keeps
resolving to `~/.opencode-mem/data`. Your legacy directory is untouched
either way.

Fresh installs (no `~/.opencode-mem` directory) start directly at the omms
paths; no marker or backup is created.

## Before you upgrade

- Close OpenCode and Pi while the first omms start runs the migration. The
  migration copies the store as it reads it; concurrent writes from another
  process could miss the copy window.
- Make sure you have disk space for one backup of `~/.opencode-mem` plus one
  copy of the store.

## Rollback

Two options, both safe because the legacy directory is never modified:

1. **Point storage at the original** (recommended). Set `storagePath` in
   `~/.config/omms/omms.jsonc`:

   ```jsonc
   {
     "storagePath": "~/.opencode-mem/data",
   }
   ```

   omms then reads and writes the legacy directory exactly as before. Remove
   the setting to return to `~/.omms/data`.

2. **Restore the backup.** The verified backup at
   `~/.omms/backups/opencode-mem-<timestamp>/` is a full copy of the legacy
   directory. Copy it back if you ever damage the original:

   ```bash
   rsync -a ~/.omms/backups/opencode-mem-<timestamp>/ ~/.opencode-mem/
   ```

## If the migration failed

A failed marker (`status: "failed"` in `~/.omms/migration-marker.json`) keeps
omms on the legacy layout, so nothing is lost. To retry:

1. Close OpenCode and Pi.
2. Read the marker's `stage` and `error` fields and fix the cause (commonly
   disk space or permissions on `~/.omms`).
3. Delete `~/.omms/migration-marker.json` and, if present, the partial
   `~/.omms/data` directory (the migration removes it itself, but a crashed
   run can leave it behind).
4. Start OpenCode or Pi once; the migration runs again.

You can also inspect the backup's `manifest.json` and compare checksums
manually:

```bash
shasum -a 256 ~/.opencode-mem/data/global.sqlite
jq '.files[] | select(.path == "data/global.sqlite")' \
  ~/.omms/backups/opencode-mem-<timestamp>/manifest.json
```

## Configuration: dual-read

`~/.config/omms/omms.jsonc` is the primary config. The legacy
`~/.config/opencode/opencode-mem.jsonc` is read only while no omms config
file exists, and it is never written. To migrate your settings by hand, copy
the legacy file to `~/.config/omms/omms.jsonc` and edit it; once the omms file
exists it takes precedence. A fresh install with no config at all gets a
commented template at `~/.config/omms/omms.jsonc`.

Project-level overrides live in `<project>/.opencode/omms.jsonc`. The legacy
`<project>/.opencode/opencode-mem.jsonc` is still read when no `omms.jsonc`
exists; when both exist, `omms.jsonc` wins. Rename the file at your own pace.

## Container tag prefix

Memory rows written by older versions carry the `opencode_project_<hash>`
and `opencode_user_<hash>` container tag prefix. From the release that
includes the tag prefix migration, new memories carry `omms_` instead, and
stored rows are migrated automatically on the first start.

### What happens automatically

On the first start after upgrading, before any memory read or write is
served:

1. **Backup.** A timestamped, checksum-verified copy of the ENTIRE store
   directory is created at `~/.omms/backups/tag-prefix-<timestamp>/`, beside
   the directory-migration backups, with a `manifest.json` recording every
   file's size and SHA-256. The backup is verified before anything is
   rewritten. It is never deleted or modified. If it cannot be created or
   verified, nothing is rewritten and the start aborts with an error.
2. **Rewrite.** Every memory row's `container_tag` is rewritten from
   `opencode_<scope>_<hash>` to `omms_<scope>_<hash>` across all project and
   user shards. Each shard is rewritten by one SQL UPDATE inside that shard's
   write transaction, under the existing cross-process write lock, so a
   concurrent host can never interleave with the rewrite.
3. **Verification.** Per shard: the row count is unchanged, the memory id set
   is unchanged, the number of rewritten rows equals the number of `opencode_`
   rows seen before, and zero `opencode_` rows remain. Any mismatch rolls
   that shard's transaction back and aborts the start. Vectors, metadata, and
   every other column are untouched.
4. **Marker.** Completion is recorded in a `tag_prefix_migration` table in
   the store's `metadata.db`; per-shard progress is recorded in each shard's
   `shard_metadata` table. Later starts see the marker and do nothing.

The migration is idempotent and resumable. An interrupted run resumes on the
remaining shards only. A crash between the last shard rewrite and the marker
write completes on the next start without rewriting anything.

Close OpenCode and Pi while the first start after upgrade runs the migration,
for the same reason as the directory migration above.

### Rollback

Restore the verified backup over the store directory, then optionally set
`containerTagPrefix` to `opencode` so tags match the restored rows:

```bash
rsync -a ~/.omms/backups/tag-prefix-<timestamp>/ ~/.omms/data/
```

```jsonc
{
  // ~/.config/omms/omms.jsonc — only while running on a restored pre-migration store
  "containerTagPrefix": "opencode",
}
```

### Config warning

If your config explicitly sets `containerTagPrefix: "opencode"`, omms warns
once at startup after the migration: stored rows carry `omms_`, so the
override matches no rows. Remove the override. The setting itself still
works for custom prefixes.

Operators can disable the automatic gate with `OMMS_SKIP_TAG_PREFIX_MIGRATION=1`.
The test suite uses this; do not set it during normal use.

## Log files

New logs go to `~/.omms/omms.log` with `omms-<date>.log` archives. Set
`OMMS_LOG_FILE` to override the path; the legacy `OPENCODE_MEM_LOG_FILE` is
still honoured when `OMMS_LOG_FILE` is unset. Old logs stay in
`~/.opencode-mem/` untouched.
