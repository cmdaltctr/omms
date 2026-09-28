# Migrating from opencode-mem to omms

omms is this fork's own identity. The upstream project owns `opencode-mem` on
npm. From version 3.0.0 the two are fully separate:

| What                 | Legacy (opencode-mem)                    | omms                                                      |
| -------------------- | ---------------------------------------- | --------------------------------------------------------- |
| npm package          | `opencode-mem`                           | `om-memory-system`                                        |
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

On the first start after the upgrade, omms runs a one-time migration if
`~/.opencode-mem/data` exists and `~/.omms/data` does not:

1. **Backup.** omms makes a timestamped backup of the WHOLE `~/.opencode-mem`
   directory at `~/.omms/backups/opencode-mem-<timestamp>/`. A
   `manifest.json` records each file's size and SHA-256 checksum. omms checks
   the backup before it does anything else.
2. **Copy.** omms COPIES the store to `~/.omms/data` and checks each copied
   file against its source. It never moves, renames, changes or deletes the
   legacy directory.
3. **Marker.** `~/.omms/migration-marker.json` records the source, the
   destination, the backup path, the file count and the times. Later starts
   see the marker and do nothing.

If the backup or any file check fails:

- the migration stops at once
- it writes a marker with `status: "failed"`
- storage stays on `~/.opencode-mem/data`

Your legacy directory is untouched in every case.

A fresh install (no `~/.opencode-mem` directory) starts directly on the omms
paths. It makes no marker and no backup.

## Before you upgrade

- Close OpenCode and Pi while the first omms start runs the migration. The copy
  reads the store as it is. Writes from another process at the same time could
  be missed.
- Make sure you have disk space for one backup of `~/.opencode-mem` and one
  copy of the store.

## Rollback

Both options are safe, because omms never changes the legacy directory.

1. **Point storage at the original** (recommended). Set `storagePath` in
   `~/.config/omms/omms.jsonc`:

   ```jsonc
   {
     "storagePath": "~/.opencode-mem/data",
   }
   ```

   omms then reads and writes the legacy directory as before. Remove the
   setting to go back to `~/.omms/data`.

2. **Restore the backup.** The backup at
   `~/.omms/backups/opencode-mem-<timestamp>/` is a full copy of the legacy
   directory. Copy it back if the original is ever damaged:

   ```bash
   rsync -a ~/.omms/backups/opencode-mem-<timestamp>/ ~/.opencode-mem/
   ```

## If the migration failed

A failed marker (`status: "failed"` in `~/.omms/migration-marker.json`) keeps
omms on the legacy layout, so nothing is lost. To try again:

1. Close OpenCode and Pi.
2. Read the `stage` and `error` fields in the marker.
3. Fix the cause. It is often disk space or permissions on `~/.omms`.
4. Delete `~/.omms/migration-marker.json`.
5. Delete the partial `~/.omms/data` directory if it is there. A crashed run
   can leave it behind.
6. Start OpenCode or Pi once. The migration runs again.

You can also compare checksums with the backup's `manifest.json` by hand:

```bash
shasum -a 256 ~/.opencode-mem/data/metadata.db
jq '.files[] | select(.path == "data/metadata.db")' \
  ~/.omms/backups/opencode-mem-<timestamp>/manifest.json
```

## Configuration: reading both files

- `~/.config/omms/omms.jsonc` is the primary config.
- omms reads the legacy `~/.config/opencode/opencode-mem.jsonc` only while no
  omms config file exists. It never writes to it.
- To move your settings by hand, copy the legacy file to
  `~/.config/omms/omms.jsonc` and edit it. Once the omms file exists, it wins.
- A fresh install with no config gets a commented template at
  `~/.config/omms/omms.jsonc`.

Project settings live in `<project>/.opencode/omms.jsonc`. omms still reads the
legacy `<project>/.opencode/opencode-mem.jsonc` when no `omms.jsonc` exists.
When both exist, `omms.jsonc` wins. Rename the file when it suits you.

## Container tag prefix

A container tag marks which project or user a memory belongs to. Older versions
wrote memory rows with the `opencode_project_<hash>` and
`opencode_user_<hash>` prefixes. From the release with the tag prefix
migration, new memories use `omms_`. Stored rows are migrated automatically on
the first start.

### What happens automatically

On the first start after the upgrade, before OMMS serves any memory read or
write:

1. **Backup.** omms makes a timestamped copy of the WHOLE store directory at
   `~/.omms/backups/tag-prefix-<timestamp>/`.
   - A `manifest.json` records each file's size and SHA-256 checksum.
   - omms checks the backup before it rewrites anything.
   - omms never deletes or changes the backup.
   - If the backup cannot be made or checked, nothing is rewritten and the
     start stops with an error.
2. **Rewrite.** omms rewrites each memory row's `container_tag` from
   `opencode_<scope>_<hash>` to `omms_<scope>_<hash>`, in every project and
   user shard.
   - Each shard gets one SQL UPDATE inside that shard's write transaction.
   - This runs under the existing cross-process write lock, so another host
     cannot write in the middle of it.
3. **Checks.** For each shard, omms checks that:
   - the row count has not changed
   - the set of memory IDs has not changed
   - the number of rewritten rows equals the number of `opencode_` rows before
   - no `opencode_` rows remain

   Any mismatch rolls back that shard's transaction and stops the start.
   Vectors, metadata and all other columns are not touched.

4. **Marker.** A `tag_prefix_migration` table in the store's `metadata.db`
   records completion. Each shard's `shard_metadata` table records progress for
   that shard. Later starts see the marker and do nothing.

You can safely run the migration more than once, and it continues after an
interruption:

- An interrupted run continues on the remaining shards only.
- If a crash happens after the last shard rewrite but before the marker write,
  the next start completes it without rewriting anything.

Close OpenCode and Pi while the first start after the upgrade runs this
migration, for the same reason as the directory migration above.

### Rollback

1. Restore the backup over the store directory:

   ```bash
   rsync -a ~/.omms/backups/tag-prefix-<timestamp>/ ~/.omms/data/
   ```

2. Optionally, set `containerTagPrefix` to `opencode` so tags match the
   restored rows:

   ```jsonc
   {
     // ~/.config/omms/omms.jsonc: only while running on a restored pre-migration store
     "containerTagPrefix": "opencode",
   }
   ```

### Config warning

If your config sets `containerTagPrefix: "opencode"`, omms warns once at
startup after the migration. Stored rows now use `omms_`, so that setting
matches no rows. Remove it. The setting still works for custom prefixes.

To turn off the automatic step, set `OMMS_SKIP_TAG_PREFIX_MIGRATION=1`. The
test suite uses this. Do not set it in normal use.

## Log files

- New logs go to `~/.omms/omms.log`, with `omms-<date>.log` archives.
- Set `OMMS_LOG_FILE` to use a different path.
- omms still honours the legacy `OPENCODE_MEM_LOG_FILE` when `OMMS_LOG_FILE` is
  not set.
- Old logs stay untouched in `~/.opencode-mem/`.
