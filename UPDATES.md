# How OMMS updates

OMMS is one npm package, `om-memory-system`. Each host keeps its own copy of it. Pi and OpenCode install each new release by themselves, then ask you to restart. Claude Code does the same through its session-start hook. The web app also installs each new release by itself, and restarts on it without asking. Claude Code's marketplace auto-update is a separate setting that you can turn on. You update one host. Every other part of OMMS on the machine runs that copy. See [One update updates every host](#one-update-updates-every-host).

| Host                         | How you hear about a new release                                                                                                                                                                                             | Update with                                                                                                                                                                                                                                                                       | Then                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pi                           | OMMS installs it in the background. The footer shows `omms: ✔ · 4.3.0 installed, restart`, and one message tells you to restart Pi                                                                                           | `pi update npm:om-memory-system` (OMMS runs it for you)                                                                                                                                                                                                                           | Restart Pi                                                                                    |
| OpenCode v2                  | OMMS installs it in the background. The footer shows `omms: ✔ · 4.3.0 installed, restart`, and one message tells you to restart OpenCode and run `opencode service restart`. `opencode plugin check` also lists new releases | `opencode plugin update om-memory-system` (OMMS runs it for you)                                                                                                                                                                                                                  | Restart OpenCode, then run `opencode service restart`                                         |
| Claude Code                  | The status line shows `omms: connected · 4.4.0 available`, and a toast tells you the command. `claude plugin list` shows the installed version. Auto-update is off until you turn it on for the `omms` marketplace           | `claude plugin update omms@omms`                                                                                                                                                                                                                                                  | Run `/reload-plugins` or start a new session                                                  |
| Web app and terminal command | OMMS installs it in the background. The sidebar shows the running version, and an open page reloads on the new version. The Settings page **Web app** card shows the global version                                          | Nothing. The web app installs the release globally with npm and restarts on it by itself. For a manual retry, select **Update**, then **Update web app**, or run `om-memory-system web update`. A global install from 4.3 or earlier needs one `npm i -g om-memory-system@latest` | An open page reloads when the new copy answers. The next host start replaces an older web app |

## How Pi and OpenCode update

When a Pi or OpenCode V2 session starts, OMMS compares its version with npm `latest`. OpenCode checks again every 6 hours. When npm has a newer release that is not a prerelease, OMMS runs the host update command in the background. A second session does not start another update for the same release within 30 minutes.

While the update installs, OMMS shows `om-memory-system <version> is installing in the background.` When it ends:

- Success: OMMS checks that the new version is on disk. The footer then shows `omms: ✔ · <version> installed, restart`, and one message tells you to restart the host.
- Failure: the footer shows `· <version> available`, and one message names the update command. Run it yourself. OMMS also shows this when the update command ends with success but the new version is not on disk.

You must restart Pi or OpenCode to load the new copy. OMMS never restarts the host. OpenCode's background server keeps the old copy in memory. For OpenCode, also run `opencode service restart`.

OMMS does not run the update in two cases. The notice then shows `<version> available` and the command to run.

- A local checkout. OMMS does not load from a `node_modules/om-memory-system/` folder.
- A pinned version. For Pi, that is a `packages` entry `npm:om-memory-system@<version>` or a settings file that OMMS cannot read. See [Stay on one version](#stay-on-one-version).

Your OpenCode config names the plugin without a version: `"om-memory-system"`. That means "latest". OpenCode resolves "latest" once and saves that version in `~/.cache/opencode/npm/`. The OMMS update refreshes that copy. The `opencode plugin update` command reads `~/.config/opencode/cli.json`, so add `"plugins": ["om-memory-system"]` there too. See [OpenCode setup](docs/opencode-adapter.md).

Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn off the npm check and the update. The check sends no session content.

OpenCode keeps each update in a new folder under `~/.cache/opencode/npm/om-memory-system@latest/`, about 900 MB each, and never removes the old ones. When the OpenCode background service starts, OMMS removes the older OMMS folders. It keeps the running folder, newer folders, the folder in `~/.omms/runtime.json`, and folders without a readable version. It removes nothing while the running folder is less than 24 hours old. See [Updating and upgrading](docs/upgrading.md#updating-omms).

## Claude Code updates

The `omms` marketplace installs from the GitHub `stable` branch. It receives only versions approved on npm: the channel workflow moves `stable` to the release tag named by npm `latest` within an hour of approval, or at once after manual dispatch. Claude Code installs that version at its next update check when auto-update is on.

For local plugin testing, run `claude --plugin-dir /absolute/path/to/omms`. Adding a checkout as a local marketplace still installs from GitHub `stable`.

Claude Code updates a marketplace plugin by itself only when that marketplace has auto-update on. Third-party marketplaces, such as `omms`, start with auto-update off. To turn it on, run `/plugin`, open **Marketplaces**, select `omms`, and select **Enable auto-update**. A running session keeps the old copy until you run `/reload-plugins` or start a new session.

Claude Code 2.1.295 or later shows an OMMS status line under the prompt. When npm has a newer stable release than the copy that the hooks run, the line adds `· <version> available` and a toast names `claude plugin update omms@omms`. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off. See [Claude Code adapter: Status line](docs/claude-code-adapter.md#status-line).

The Claude Code hooks run through the launcher in the plugin. The launcher runs the newest OMMS copy on the machine. When every copy is older than the plugin, it runs `npx --yes om-memory-system@<plugin version>`. A global install is optional. Node.js 22.14 or later is required. See [Updating and upgrading](docs/upgrading.md#claude-code).

## One update updates every host

OMMS keeps one record of the newest copy on the machine: `~/.omms/runtime.json`. OpenCode, Pi, and each `om-memory-system` run write their own copy to it when that copy is newer.

- The login item runs `~/.omms/bin/omms-launch.mjs`, which starts the newest copy at the next login.
- An OpenCode start, a Pi start, or a Claude Code `SessionStart` replaces a web app that is older than the newest copy. You do not sign in again.
- An old `om-memory-system` command runs the newest copy. Set `OMMS_NO_HANDOFF=1` to turn this off for one command.

## The web app and the login item

The login web app runs one copy of OMMS for every host. The login item runs the launcher at `~/.omms/bin/omms-launch.mjs`. The launcher starts the newest valid copy named in the record, so an older host copy never replaces a newer one.

The standalone web app updates itself. When its npm check finds a newer release that is not a prerelease, it installs the release globally with npm and restarts on it through the launcher: the same install the **Update** button starts, with no button pressed. An open page reloads when the new copy answers. After a failed automatic install it waits 30 minutes before the next automatic try; the **Update** button and `om-memory-system web update` work at any time. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check and the automatic install off. A web app started inside a Pi or OpenCode session never updates itself. See [Web UI: Update button](docs/web-ui.md#update-button).

## Stay on one version

Install with a version number, for example `pi install npm:om-memory-system@4.2.0` or `opencode plugin add om-memory-system@4.2.0`. OpenCode skips exact versions during `plugin check` and `plugin update`. OMMS does not update a pinned install in the background. It can still show its own newer-release notice. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn that notice off.

More detail: [Updating and upgrading](docs/upgrading.md).
