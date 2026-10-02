# How OMMS updates

OMMS is one npm package, `om-memory-system`. Each host keeps its own copy of it. No host installs an update by itself. You choose when to update, then restart the host.

| Host                         | How you hear about a new release                                                                                              | Update with                                                             | Then                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Pi                           | Pi shows an update notice when it starts                                                                                      | `pi update npm:om-memory-system`                                        | Restart Pi                                        |
| OpenCode v2                  | The footer shows `omms:connected · 4.3.0 available`, and a toast tells you the command. `opencode plugin check` also lists it | `opencode plugin update om-memory-system`                               | Restart OpenCode, including its background server |
| Claude Code                  | `claude plugin list` shows the installed version                                                                              | `claude plugin update omms@omms`                                        | Restart Claude Code                               |
| Web app and terminal command | The Settings page **Web app** card warns when versions differ                                                                 | `npm i -g om-memory-system@latest`, then `om-memory-system web install` | The login item restarts the web app               |

## Why OpenCode needs a manual update

Your OpenCode config names the plugin without a version: `"om-memory-system"`. That means "latest". OpenCode resolves "latest" once, saves that version in `~/.cache/opencode/npm/`, and keeps using the saved copy. It does not ask npm again at the next start. Run `opencode plugin update om-memory-system` to fetch the new release.

OMMS 4.3.0 and later check npm when OpenCode starts and then every 6 hours. When a newer release exists, the footer and a toast say so. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn the check off.

## The web app and the login item

The login web app runs one copy of OMMS for every host. When a host starts, OMMS checks the login item. It keeps the newest of three copies: the host's own copy, the global install, and the copy the item already runs. An old copy in a host's cache never replaces a newer global install.

## Stay on one version

Install with a version number, for example `pi install npm:om-memory-system@4.2.0` or `opencode plugin add om-memory-system@4.2.0`. OpenCode skips exact versions during `plugin check` and `plugin update`. OMMS can still show its own newer-release notice for a pinned OpenCode install. Set `OMMS_DISABLE_UPDATE_CHECK=1` to turn that notice off.

More detail: [Updating and upgrading](docs/upgrading.md).
