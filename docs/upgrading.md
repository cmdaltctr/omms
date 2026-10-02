# Updating and upgrading

This page covers updates, pinning a version, and older stores.

## Updating OMMS

Install OMMS without a version number, as the [README](../README.md#set-up)
shows. Your agent can then tell you when a new release is out. Neither agent
installs updates by itself. You choose when to update.

| Agent       | How you hear about a new release                                                                                             | Update with                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pi          | Pi shows an update notice while you work                                                                                     | `pi update npm:om-memory-system` (or `pi update --extensions` for all)  |
| OpenCode v2 | The footer shows `omms:connected · <version> available` and a toast names the command. `opencode plugin check` also lists it | `opencode plugin update om-memory-system` (or `opencode plugin update`) |

Restart the agent after you update. OpenCode resolves "latest" once and keeps that copy in `~/.cache/opencode/npm/`, so it does not update by itself. Set `OMMS_DISABLE_UPDATE_CHECK=1` to stop the npm check. [UPDATES.md](../UPDATES.md) has a one-page summary for every host.

### Claude Code

Claude Code updates a marketplace plugin by itself only when that marketplace has auto-update on. Third-party marketplaces, such as `omms`, start with auto-update off.

To turn on auto-update for OMMS:

1. Run `/plugin` in Claude Code.
2. Open **Marketplaces**.
3. Select `omms`.
4. Select **Enable auto-update**.

A running session keeps the old copy. Run `/reload-plugins`, or start a new session.

To update by hand:

```bash
claude plugin update omms@omms
```

The hooks run through the launcher in the plugin. The launcher runs the newest OMMS copy on the machine. When every copy is older than the plugin, it runs `npx --yes om-memory-system@<plugin version>`. A global install is optional. See [One update updates every host](#one-update-updates-every-host).

### One update updates every host

OMMS keeps one record of the newest copy on the machine: `~/.omms/runtime.json`. OpenCode, Pi, and each `om-memory-system` run write their own copy to the record when that copy is newer. You update one host. Every other part then runs that copy:

- **Login item.** The login item runs `~/.omms/bin/omms-launch.mjs`. The launcher starts the newest valid copy at the next login.
- **Running web app.** An OpenCode start, a Pi start, or a Claude Code `SessionStart` replaces a web app that is older than the newest copy. The old web app steps aside and the newest copy starts. You do not sign in again.
- **Terminal command.** An old `om-memory-system` command runs the newest copy with the same arguments, input, and exit code. `om-memory-system --version` prints the version of the copy that runs. Set `OMMS_NO_HANDOFF=1` to turn this off for one command.
- **Claude Code hooks.** The hooks use the launcher in the plugin, as described above.

A global install from 4.3 or earlier has no hand-off code. Update it once. After that, every update flows through the record:

```bash
npm i -g om-memory-system@latest   # or: bun add -g om-memory-system@latest
om-memory-system --version
```

The **Web app** card on the Settings page shows the running version and the version of the global install. It reads the global version from the install's `package.json`. See [Settings page](web-ui-settings.md).

To go back to an older version, set `OMMS_NO_HANDOFF=1` for one command. For a full rollback, remove the newer copy, then run `om-memory-system web install` from the copy to keep. When you remove the copy that the record names, the next start writes a valid copy to the record.

### Rolling back to an older version

Versions before `external` and `importPathMaps` existed treat them like this:

- They reject `"external"` as a model value. Change those values back before
  you roll back.
- They ignore `importPathMaps` and saved key files.

### Pinning a version

To stay on one version, install it with the version number:

- Pi: `pi install npm:om-memory-system@3.1.1`
- OpenCode: `opencode plugin add om-memory-system@3.1.1`

OpenCode skips exact versions during `plugin check` and `plugin update`.
OMMS can still show its own newer-release notice for a pinned OpenCode install.
Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn that notice off. To receive updates
again, install without the number.

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

## Embedding key no longer falls back to `OPENAI_API_KEY`

Before this release, an `embeddingApiUrl` without an `embeddingApiKey` used the `OPENAI_API_KEY` environment variable. Now OMMS sends no key unless you set one, so a local server never receives your OpenAI key.

If your embedding server needs that key:

1. Open `~/.config/omms/omms.jsonc`.
2. Add `"embeddingApiKey": "env://OPENAI_API_KEY"`.
3. Restart the web app and open sessions.

## API tokens replace `webServerApiToken`

This is a breaking change in the major release that adds the **Keys and access** card. It affects you only when `omms.jsonc` sets `webServerApiToken`, for example for a web app on `0.0.0.0`.

What happens at the first web app start after the upgrade:

- OMMS imports the value of `webServerApiToken` once into the API token table, as the token `from config file`. It has no expiry.
- OMMS does not change `omms.jsonc`.
- From then on, OMMS does not read `webServerApiToken`. A later change to the key has no effect.
- Scripts that send the old value keep working, because the imported token has the same value.
- The **Keys and access** card shows a warning while the config still sets the key.

What to do:

1. Open the Settings page on the computer that runs OMMS.
2. In **Keys and access**, create a new API token for each script or computer.
3. Update each script to send its new token.
4. Revoke the `from config file` token.
5. Remove `webServerApiToken` from `omms.jsonc`.

A web app on a non-loopback host now starts only when an unexpired API token exists or a browser password is set. If you revoke the last token and set no password, the web app refuses to start.

`om-memory-system web status` and `web install` now use the local token file (`~/.omms/.auth-token`), not `webServerApiToken`.

To roll back, install the previous version. It reads `webServerApiToken` again, because the import left the key in the config file. Tokens that you created in the table do not work in the previous version.

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
