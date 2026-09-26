# Updating and upgrading

## Updating OMMS

Install OMMS without a version number, as shown above, so your agent can tell
you when a new release is out. Neither agent installs updates by itself; you
choose when to update.

| Agent       | How you hear about a new release                              | Update with                                                             |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pi          | Pi shows an update notice while you work                      | `pi update npm:om-memory-system` (or `pi update --extensions` for all)  |
| OpenCode v2 | Run `opencode plugin check` to list plugins with new versions | `opencode plugin update om-memory-system` (or `opencode plugin update`) |

Restart the agent after updating.

To stay on one version, install it with the version number instead:
`pi install npm:om-memory-system@3.1.1` in Pi, or `opencode plugin add om-memory-system@3.1.1` in
OpenCode. A pinned install is never updated or flagged; install without the
number again to go back to receiving updates.

### Trying unreleased changes (`next`)

Every merge to `main` is published as a prerelease under the npm `next` tag,
for example `3.2.0-next.8`. It has not been through the release checks, so use
it only to try a change early. In Pi, install it with
`pi install npm:om-memory-system@next`; Pi then reports each newer `next`
build and `pi update` installs it. Whether OpenCode's `opencode plugin check`
reports newer `next` builds has not been verified. Install without `@next` to
return to full releases.

Release notes for every version are in [CHANGELOG.md](../CHANGELOG.md) and on the
[GitHub Releases](https://github.com/cmdaltctr/omms/releases) page.

Upgrading from an existing `opencode-mem` install? The store migrates to
`~/.omms/data` automatically on first start, with a verified backup first.
See [docs/omms-migration.md](omms-migration.md).

## Upgrading from legacy SQLite shards

On first startup after upgrading, omms automatically migrates existing memory shard databases to native Turso/libSQL vector format:

- Each shard is backed up as `<shard>.db.legacy.bak` before rewrite
- Progress is tracked per shard in `<shard>.db.turso-migrate.json`
- A global marker `.turso-migrated` is written only after all shards verify successfully
- Do not run multiple OpenCode instances against the same `storagePath` during migration; a lock file (`.turso-migrate.lock`) prevents concurrent migration
- Manual dimension migrations use `.turso-operation.lock`; other plugin processes reject new memory writes until the migration finishes

If migration is interrupted, the next startup resumes from the backup automatically.

If a shard becomes incompatible (for example after changing `embeddingDimensions`), writes are blocked and the original database is left untouched. Use the Web UI's re-embed migration to build and verify a replacement before it is swapped into place. The previous shard remains available as `<shard>.db.pre-reembed-<pid>-<timestamp>.bak`.
