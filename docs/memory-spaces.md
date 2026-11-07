# Memory spaces

A memory space is a separate store. Each space has its own memories and its own learned user profile. Use a space to start clean for an experiment, or to keep two lines of work apart. Memories can move between spaces, a space can be written to a file for a colleague, and a space can read the spaces it links.

## How spaces work

- The **Default** space is your existing store (`~/.omms/data`). It stays where it is. Nothing moves when you upgrade.
- A new space lives in `~/.omms/spaces/<id>/` and starts empty.
- One space is **active** at a time. Pi, OpenCode V2, Claude Code and the web app all use it. A switch applies from the next turn or request.
- `skills.db`, the downloaded embedding model and the icons (of the spaces and of the hosts) are shared by all spaces.
- Every memory context block that OMMS adds to a session carries the line `Active memory space: <name>`. You and the agent always see which space is in use.
- A project config that sets `storagePath` uses its own folder. It wins over the active space. The context line then says `custom storage folder set by this project`.

The registry is `~/.omms/spaces.json`. It lists the spaces and the active one. OMMS writes it in one step, so a reader never sees half a file. Do not edit it by hand. If the file cannot be read, OMMS uses the Default space, leaves the file unchanged and shows the problem in the web app status.

The Default space has no entry of its own. When you rename it, the name lives in an optional top-level `defaultName` field in the registry. Rename stays in the web app for every space, Default included; the CLI and the `memory` tool refuse it. When the field is absent, or the registry cannot be read, the name is "Default". Renaming the space back to "Default" removes the field. An older OMMS ignores the field. One that rewrites the registry drops it, and the name falls back to "Default".

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
| Transfer  | Opens the Transfer dialog. Preview first, then copy or move memories into another space.            |
| Export    | Opens the Export dialog. Writes the space to a file you can share.                                  |

The Default space and the active space cannot be archived or deleted. The page disables those actions and says why.

Next to the space list, **Import** reads an export file into a new space. Each card also has a **Linked spaces** section. See [Web UI: Spaces page](web-ui.md#spaces-page).

## Use spaces from a terminal or an agent

```bash
om-memory-system space list
om-memory-system space create "Client work"
om-memory-system space use "Client work"
om-memory-system space archive "Client work"
om-memory-system space copy --from Experiments --to "Client work" --since 2026-10-01
om-memory-system space link "Client work" --in Experiments
```

The `memory` tool has a `space` mode with the same actions: `list`, `status`, `create`, `use`, `archive`, `unarchive`, `preview`, `copy`, `link` and `unlink`. Pi, OpenCode V2 and Claude Code get the same mode. For example, tell the agent "save my work in the space Aizat" and it switches.

An agent or a terminal cannot delete, rename, back up, restore or move a space's memories. They answer "Only the web app can delete a space." and "Only the web app can move memories between spaces." Use the web app for those actions. Export and import run in the web app and the CLI. The `memory` tool refuses them: "The memory tool cannot export a space. Use the web app or the CLI."

See [CLI reference](cli.md#memory-spaces) for the command.

## Transfer memories between spaces

A transfer names a source space and a target space. Neither needs to be the active space. A transfer can filter by a date range on the creation time of a memory, and by source project.

1. Preview first. The preview shows the count of memories, the source projects with a count each, up to five example memories, and how many exact duplicates the target already holds. A preview changes nothing.
2. Apply. Copy adds the memories to the target and leaves the source unchanged. Move is only in the web app, after a confirm dialog.

A memory is skipped when the target already holds the same id, or the same text under the same project tag. Similar memories are copied. The result reports how many memories were copied and how many were skipped. When both spaces use the same embedding model and dimensions, the copy reuses the stored vectors. Otherwise OMMS embeds again.

Move removes a memory from the source only after the copy in the target is checked. Skipped duplicates stay in the source. If the check fails, OMMS removes nothing.

**The move window.** A crash between the check and the removal leaves the memory in both spaces. No memory is lost. A re-run reports the leftover as an exact duplicate and does not remove it. Delete the leftover yourself if this happens. The window is a few milliseconds long.

The web app runs one transfer at a time. A second apply while one runs is refused with "Another transfer is running", and both spaces stay unchanged.

```bash
om-memory-system space preview --from Experiments --to "Client work" --since 2026-10-01
om-memory-system space copy --from Experiments --to "Client work" --since 2026-10-01
```

## Export a space to a file

`om-memory-system space export <name> --out <file>` writes one space to a JSON file that is safe to hand to a colleague. The **Export** button on a card does the same and offers the file as a download.

- The file holds each memory's id, text, tags, type, times, pin state and project tag. It holds no vectors.
- The file holds no absolute path, user name, display name, email address or repository URL in a structured field.
- OMMS replaces a home-folder path in memory text with `~` and an email address with `<email>`. Text inside `<private>` tags is removed. The result reports how many paths and emails it replaced.
- A final scan checks the finished file. When a home path or an email address survives, the export fails and OMMS writes no file.
- Free-text names are not detected. Check the file before you share it.
- The learned profile and the personal (user-scope) memories stay out unless you pass `--include-profile`.
- `--since` and `--until` limit the export by creation time. When the selection holds no memory, OMMS writes no file and says so.

## Import a space from a file

`om-memory-system space import <file> --name <new>` reads an export file into a new space. Import never writes into an existing space and never changes the active space. A name that is already taken is refused.

- Import embeds every memory again with this machine's embedding model. When the file's model or dimensions differ from the settings, OMMS warns and names both. The warning does not block the import.
- Project memories keep the file's project tags by default. A project tag hashes a project identity, so tags are machine-local: a project-scope search finds the imported memories only when that project's identity hash matches. An all-projects search always finds them.
- `--retag-to-project <folder>` gives every project memory the project tag of that folder on this machine. The folder must exist, and the check runs before any space is created. User-scope memories always take the importing user's tag.
- The file must be at most 100 MB.
- When the import fails after the new space exists, OMMS removes the new space and its folder and reports the failure.

## Linked spaces

A space can list other spaces it reads. A link is one-way: it lets the space read the linked space and gives the linked space nothing in return. Links are not followed further. When A links B and B links C, a search in A reads A and B only.

- A memory search in a space also searches its linked spaces. Results of the space in use rank first. Linked results fill the remaining places, and each carries the name of its space.
- Capture and profile learning never read or write linked spaces. A capture writes only to the space in use.
- `forget` and `edit` refuse a memory of a linked space and name the space.
- A linked space is skipped with a warning when it is archived, its folder is missing, or its embedding model or dimensions differ from the current settings.
- The Default space cannot own links. Other spaces can link it.
- Deleting or archiving a linked space leaves the link in place. It shows as unavailable.

```bash
om-memory-system space link "Client work" --in Experiments
om-memory-system space unlink "Client work" --in Experiments
```

`--in` names the space that owns the link. Without it, the active space owns the link.

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
- A move has a short window between the checked copy and the removal from the source. A crash inside the window leaves the memory in both spaces. See [Transfer memories between spaces](#transfer-memories-between-spaces).
- The one-transfer-at-a-time rule applies inside the web app. A transfer in a terminal and one in the web app exclude each other through the store's write locks.
- An export file holds no free-text names, and the scrubber reports only paths and emails. Check the file before you share it.
- Import re-embeds every memory, so a large file takes time.
- Linked spaces are read in recall only. They hold no write path, so they never receive new memories.
- If the active space's folder is missing, OMMS uses the Default space and shows the problem.

## See also

- [Configuration](configuration.md) for `storagePath`.
- [ADR-041](adr/041-a-memory-space-is-a-storage-folder.md) for the space decision.
- [ADR-042](adr/042-a-space-bound-store-and-linked-read-only-spaces.md) for the transfer, export and link decision.
