# Updating and upgrading

This page covers updates, pinning a version, and older stores.

## Updating OMMS

Install OMMS without a version number, as the [README](../README.md#set-up)
shows. Your agent can then tell you when a new release is out. Neither agent
installs updates by itself. You choose when to update.

| Agent       | How you hear about a new release                              | Update with                                                             |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pi          | Pi shows an update notice while you work                      | `pi update npm:om-memory-system` (or `pi update --extensions` for all)  |
| OpenCode v2 | Run `opencode plugin check` to list plugins with new versions | `opencode plugin update om-memory-system` (or `opencode plugin update`) |

Restart the agent after you update.

### The global terminal command

If you installed the terminal command globally (see
[CLI](cli.md#global-install-optional-recommended)), update it on its own:

```bash
npm i -g om-memory-system@latest   # or: bun add -g om-memory-system@latest
om-memory-system --version
```

The **Web app** card on the Settings page warns when the global command's
version is different from the OMMS version that serves the page. See
[Settings page](web-ui-settings.md).

### Rolling back to an older version

Versions before `external` and `importPathMaps` existed treat them like this:

- They reject `"external"` as a model value. Change those values back before
  you roll back.
- They ignore `importPathMaps` and saved key files.

### Pinning a version

To stay on one version, install it with the version number:

- Pi: `pi install npm:om-memory-system@3.1.1`
- OpenCode: `opencode plugin add om-memory-system@3.1.1`

A pinned install is never updated or flagged. To receive updates again,
install without the number.

### Trying unreleased changes (`next`)

Every merge to `main` is published as a prerelease under the npm `next` tag,
for example `3.2.0-next.8`. It has not been through the release checks. Use it
only to try a change early.

- In Pi, install it with `pi install npm:om-memory-system@next`. Pi then
  reports each newer `next` build, and `pi update` installs it.
- We have not checked whether OpenCode's `opencode plugin check` reports newer
  `next` builds.
- To return to full releases, install without `@next`.

Release notes for every version are in [CHANGELOG.md](../CHANGELOG.md) and on
the [GitHub Releases](https://github.com/cmdaltctr/omms/releases) page.

Upgrading from an `opencode-mem` install? The store moves to `~/.omms/data`
automatically on first start, after a verified backup. See
[Migrating from opencode-mem](omms-migration.md).

## Upgrading from legacy SQLite shards

A shard is one memory database file. On the first start after an upgrade, OMMS
converts old shards to the native Turso/libSQL vector format:

- Each shard is backed up as `<shard>.db.legacy.bak` before it is rewritten.
- Progress for each shard is kept in `<shard>.db.turso-migrate.json`.
- OMMS writes the global marker `.turso-migrated` only after every shard
  passes its checks.
- Do not run several OpenCode instances on the same `storagePath` during this
  step. A lock file, `.turso-migrate.lock`, stops two migrations at once.
- Manual dimension migrations use `.turso-operation.lock`. Other plugin
  processes refuse new memory writes until the migration finishes.

If the migration stops part way, the next start continues from the backup.

A shard can become incompatible, for example after you change
`embeddingDimensions`. OMMS then blocks writes and leaves the original
database untouched. To fix it:

1. Open the web UI.
2. Run the re-embed migration. It builds and checks a replacement shard.
3. OMMS swaps the replacement into place.

The previous shard stays available as
`<shard>.db.pre-reembed-<pid>-<timestamp>.bak`.
