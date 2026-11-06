# Memory spaces

A memory space is a separate store. Each space has its own memories and its own learned user profile. Use a space to start clean for an experiment, or to keep two lines of work apart.

## How spaces work

- The **Default** space is your existing store (`~/.omms/data`). It stays where it is. Nothing moves when you upgrade.
- A new space lives in `~/.omms/spaces/<id>/` and starts empty.
- One space is **active** at a time. Pi, OpenCode V2, Claude Code and the web app all use it. A switch applies from the next turn or request.
- `skills.db`, the downloaded embedding model and the icons (of the spaces and of the hosts) are shared by all spaces.
- Every memory context block that OMMS adds to a session carries the line `Active memory space: <name>`. You and the agent always see which space is in use.
- A project config that sets `storagePath` uses its own folder. It wins over the active space. The context line then says `custom storage folder set by this project`.

The registry is `~/.omms/spaces.json`. It lists the spaces and the active one. OMMS writes it in one step, so a reader never sees half a file. Do not edit it by hand. If the file cannot be read, OMMS uses the Default space, leaves the file unchanged and shows the problem in the web app status.

## Use spaces in the web app

The **Spaces** item (a boxes icon) at the top of the sidebar opens the Spaces page. Its tree lists the spaces that are not archived, like the Memory tree. The active space has a green dot. A click on a space in the tree opens its card. It does not switch the space. The **Activate** button on the card does. The last row of the tree, **Archive**, opens the Archive page, which lists the archived spaces.

On the Spaces page, each space is a card. On a card you can:

| Action    | What happens                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- |
| Create    | Adds an empty space. It does not become active.                                                     |
| Rename    | Changes the display name. The folder name stays the same.                                           |
| Switch    | Makes the space active.                                                                             |
| Archive   | Moves the space to the Archive page and hides it from the sidebar tree. The data stays.             |
| Unarchive | The **Restore** button on the Archive page (or `space unarchive`) returns the space to the tree.    |
| Back up   | Copies the space to `~/.omms/backups/space-<id>-<time>/` and checks the copy.                       |
| Delete    | Makes a verified backup, removes the space, and shows where the backup is. You type the space name. |
| Restore   | Creates a new space from a backup, named `<name> (restored <date>)`. It never overwrites a space.   |

The Default space and the active space cannot be archived or deleted. The page disables those actions and says why.

## Use spaces from a terminal or an agent

```bash
om-memory-system space list
om-memory-system space create "Client work"
om-memory-system space use "Client work"
om-memory-system space archive "Client work"
```

The `memory` tool has a `space` mode with the same actions: `list`, `status`, `create`, `use`, `archive` and `unarchive`. Pi, OpenCode V2 and Claude Code get the same mode. For example, tell the agent "save my work in the space Aizat" and it switches.

An agent or a terminal cannot delete, rename, back up or restore a space. They answer "Only the web app can delete a space." Use the web app for those actions.

See [CLI reference](cli.md#memory-spaces) for the command.

## Backups

- A backup holds a copy of every store file and a `manifest.json` with a SHA-256 checksum for each file, and the space id, name and OMMS version.
- SQLite files are copied with `VACUUM INTO`. A backup of the active space is consistent while hosts write.
- The model cache is not part of a backup.
- OMMS checks the copy before it reports success. If a copy does not match, the backup fails and OMMS removes the incomplete folder.
- Restore checks every file against the manifest first. A damaged backup creates no space, and the message names the damaged file.

## Delete a space

1. Open the Spaces page and choose **Delete** for the space.
2. Read the dialog. OMMS makes a backup first, then removes the space.
3. Type the space name and confirm.
4. Note the backup location that the page shows. Restore the backup later if you change your mind.

If OMMS cannot remove the folder after the backup and the registry entry, it shows the folder path and does not retry. Remove the folder yourself.

## Limits

- A switch does not stop work in progress. A turn that began before the switch can finish in the old space.
- Spaces do not share memories. Moving, merging and exporting memories between spaces is planned as a later change.
- If the active space's folder is missing, OMMS uses the Default space and shows the problem.

## See also

- [Configuration](configuration.md) for `storagePath`.
- [ADR-041](adr/041-a-memory-space-is-a-storage-folder.md) for the decision.
