# Migrating from opencode-mem to omms

omms is the fork's package identity (upstream owns `opencode-mem` on npm).
From version 3.0.0 the identity is fully separated:

| What                 | Legacy (opencode-mem)                   | omms                        |
| -------------------- | --------------------------------------- | --------------------------- |
| Package              | `opencode-mem`                          | `omms`                      |
| Default store        | `~/.opencode-mem/data`                  | `~/.omms/data`              |
| Primary config       | `~/.config/opencode/opencode-mem.jsonc` | `~/.config/omms/omms.jsonc` |
| Plugin id            | `opencode-mem`                          | `omms`                      |
| Log file             | `~/.opencode-mem/opencode-mem.log`      | `~/.omms/omms.log`          |
| Container tag prefix | `opencode_project_<hash>`               | unchanged (see below)       |

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

Project-level config files keep their existing names and locations
(`<project>/.opencode/opencode-mem.jsonc`) for compatibility.

## Container tag prefix

Memory rows keep the `opencode_project_<hash>` and `opencode_user` container
tag prefix. It is the historical on-disk format name: rewriting every memory
row across all shards for a cosmetic rename is unjustified risk, so the
migration does not touch it. The prefix stays configurable via
`containerTagPrefix` if you ever need a different one.

## Log files

New logs go to `~/.omms/omms.log` with `omms-<date>.log` archives. Set
`OMMS_LOG_FILE` to override the path; the legacy `OPENCODE_MEM_LOG_FILE` is
still honoured when `OMMS_LOG_FILE` is unset. Old logs stay in
`~/.opencode-mem/` untouched.
