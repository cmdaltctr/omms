# How OMMS updates

OMMS is one npm package, `om-memory-system`. Each host keeps its own copy of it. Pi and OpenCode never install an update by themselves. Claude Code does only when you turn on auto-update for the `omms` marketplace. Otherwise you choose when to update, then restart the host. You update one host. Every other part of OMMS on the machine then runs that copy. See [One update updates every host](#one-update-updates-every-host).

| Host                         | How you hear about a new release                                                                                                                                                                                   | Update with                                                                                                                                                                                                                                   | Then                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pi                           | Pi shows an update notice when it starts                                                                                                                                                                           | `pi update npm:om-memory-system`                                                                                                                                                                                                              | Restart Pi                                        |
| OpenCode v2                  | The footer shows `omms:connected · 4.3.0 available`, and a toast tells you the command. `opencode plugin check` also lists it                                                                                      | `opencode plugin update om-memory-system`                                                                                                                                                                                                     | Restart OpenCode, including its background server |
| Claude Code                  | The status line shows `omms: connected · 4.4.0 available`, and a toast tells you the command. `claude plugin list` shows the installed version. Auto-update is off until you turn it on for the `omms` marketplace | `claude plugin update omms@omms`                                                                                                                                                                                                              | Run `/reload-plugins` or start a new session      |
| Web app and terminal command | The sidebar shows the running version. An **Update** button appears in the sidebar footer when npm has a newer release. The Settings page **Web app** card shows the global version                                | Nothing. They run the newest copy. Or select **Update**, then **Update web app**: it installs the release globally with npm and restarts the web app on it. A global install from 4.3 or earlier needs one `npm i -g om-memory-system@latest` | The next host start replaces an older web app     |

## Why OpenCode needs a manual update

Your OpenCode config names the plugin without a version: `"om-memory-system"`. That means "latest". OpenCode resolves "latest" once, saves that version in `~/.cache/opencode/npm/`, and keeps using the saved copy. It does not ask npm again at the next start. Run `opencode plugin update om-memory-system` to fetch the new release. That command reads `~/.config/opencode/cli.json`, so add `"plugins": ["om-memory-system"]` there too. See [OpenCode setup](docs/opencode-adapter.md).

OMMS 4.3.0 and later check npm when OpenCode starts and then every 6 hours. When a newer release exists, the footer and a toast say so. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off.

## Claude Code updates

The `omms` marketplace installs from the GitHub `stable` branch. It receives only versions approved on npm: the channel workflow moves `stable` to the release tag named by npm `latest` within an hour of approval, or at once after manual dispatch. Claude Code installs that version at its next update check when auto-update is on.

For local plugin testing, run `claude --plugin-dir /absolute/path/to/omms`. Adding a checkout as a local marketplace still installs from GitHub `stable`.

Claude Code updates a marketplace plugin by itself only when that marketplace has auto-update on. Third-party marketplaces, such as `omms`, start with auto-update off. To turn it on, run `/plugin`, open **Marketplaces**, select `omms`, and select **Enable auto-update**. A running session keeps the old copy until you run `/reload-plugins` or start a new session.

Claude Code 2.1.287 or later shows an OMMS status line under the prompt. When npm has a newer stable release than the copy that the hooks run, the line adds `· <version> available` and a toast names `claude plugin update omms@omms`. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off. See [Claude Code adapter: Status line](docs/claude-code-adapter.md#status-line).

The Claude Code hooks run through the launcher in the plugin. The launcher runs the newest OMMS copy on the machine. When every copy is older than the plugin, it runs `npx --yes om-memory-system@<plugin version>`. A global install is optional. Node.js 22.14 or later is required. See [Updating and upgrading](docs/upgrading.md#claude-code).

## One update updates every host

OMMS keeps one record of the newest copy on the machine: `~/.omms/runtime.json`. OpenCode, Pi, and each `om-memory-system` run write their own copy to it when that copy is newer.

- The login item runs `~/.omms/bin/omms-launch.mjs`, which starts the newest copy at the next login.
- An OpenCode start, a Pi start, or a Claude Code `SessionStart` replaces a web app that is older than the newest copy. You do not sign in again.
- An old `om-memory-system` command runs the newest copy. Set `OMMS_NO_HANDOFF=1` to turn this off for one command.

## The web app and the login item

The login web app runs one copy of OMMS for every host. The login item runs the launcher at `~/.omms/bin/omms-launch.mjs`. The launcher starts the newest valid copy named in the record, so an older host copy never replaces a newer one.

## Stay on one version

Install with a version number, for example `pi install npm:om-memory-system@4.2.0` or `opencode plugin add om-memory-system@4.2.0`. OpenCode skips exact versions during `plugin check` and `plugin update`. OMMS can still show its own newer-release notice for a pinned OpenCode install. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn that notice off.

More detail: [Updating and upgrading](docs/upgrading.md).
