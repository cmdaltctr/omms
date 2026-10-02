# How OMMS updates

OMMS is one npm package, `om-memory-system`. Each host keeps its own copy of it. Pi and OpenCode never install an update by themselves. Claude Code does only when you turn on auto-update for the `omms` marketplace. Otherwise you choose when to update, then restart the host.

| Host                         | How you hear about a new release                                                                                              | Update with                                                             | Then                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Pi                           | Pi shows an update notice when it starts                                                                                      | `pi update npm:om-memory-system`                                        | Restart Pi                                        |
| OpenCode v2                  | The footer shows `omms:connected · 4.3.0 available`, and a toast tells you the command. `opencode plugin check` also lists it | `opencode plugin update om-memory-system`                               | Restart OpenCode, including its background server |
| Claude Code                  | `claude plugin list` shows the installed version. Auto-update is off until you turn it on for the `omms` marketplace          | `claude plugin update omms@omms`                                        | Run `/reload-plugins` or start a new session      |
| Web app and terminal command | The Settings page **Web app** card warns when versions differ                                                                 | `npm i -g om-memory-system@latest`, then `om-memory-system web install` | The login item restarts the web app               |

## Why OpenCode needs a manual update

Your OpenCode config names the plugin without a version: `"om-memory-system"`. That means "latest". OpenCode resolves "latest" once, saves that version in `~/.cache/opencode/npm/`, and keeps using the saved copy. It does not ask npm again at the next start. Run `opencode plugin update om-memory-system` to fetch the new release. That command reads `~/.config/opencode/cli.json`, so add `"plugins": ["om-memory-system"]` there too. See [OpenCode setup](docs/opencode-adapter.md).

OMMS 4.3.0 and later check npm when OpenCode starts and then every 6 hours. When a newer release exists, the footer and a toast say so. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off.

## Claude Code updates

Claude Code updates a marketplace plugin by itself only when that marketplace has auto-update on. Third-party marketplaces, such as `omms`, start with auto-update off. To turn it on, run `/plugin`, open **Marketplaces**, select `omms`, and select **Enable auto-update**. A running session keeps the old copy until you run `/reload-plugins` or start a new session.

The Claude Code plugin does not update the global `om-memory-system` command or the web app. Update those with `npm i -g om-memory-system@latest`, then `om-memory-system web install`. See [Updating and upgrading](docs/upgrading.md#claude-code).

## The web app and the login item

The login web app runs one copy of OMMS for every host. When a host starts, OMMS checks the login item. It keeps the newest of three copies: the global install, the copy the item already runs, and the host's own copy. When versions are equal, it keeps them in that order, so a host's cached copy never replaces the global install.

## Stay on one version

Install with a version number, for example `pi install npm:om-memory-system@4.2.0` or `opencode plugin add om-memory-system@4.2.0`. OpenCode skips exact versions during `plugin check` and `plugin update`. OMMS can still show its own newer-release notice for a pinned OpenCode install. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn that notice off.

More detail: [Updating and upgrading](docs/upgrading.md).
