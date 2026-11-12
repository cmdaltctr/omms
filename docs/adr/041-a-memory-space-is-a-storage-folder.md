# ADR-041: A memory space is a storage folder

- **Date:** 2026-11-06
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`add-memory-spaces`](../../openspec/changes/archive/2026-11-06-add-memory-spaces/proposal.md)

## Context

OMMS kept one store. A fresh experiment or a separate line of work pulled in every memory and the learned user profile. The user could not start clean or keep two lines apart.

A second store needs a way to say which store a host reads and writes. Memory rows already carry a `container_tag`, but the user profile, the prompts, the chats and the import ledger carry none.

## Decision

1. **A space is one storage folder.** The folder has the layout of the current store. The Default space is the existing store (`storagePath`, normally `~/.omms/data`). It stays where it is, and nothing moves. Other spaces live in `~/.omms/spaces/<id>/`.
2. **The active space lives in `~/.omms/spaces.json`, not in `omms.jsonc`.** The file holds the spaces and one active space id. A switch rewrites only this file. The web app's settings writer never rewrites the user's main config for a switch. The file joins the config refresh signature, so every running host notices a switch on its next turn with no polling and no IPC.
3. **A project `storagePath` wins over the active space.** The memory context and the web app say that a custom storage folder is in use.
4. **`skills.db`, the embedding model cache and the icons stay global.** Skill learning, the downloaded model and the icons of the hosts and of the spaces belong to the person, not to a space. The space icons are in `~/.omms/space-appearance/`. See [TDR-064](../tdr/064-host-icons-lived-in-the-active-space-folder.md).
5. **A switch resets every store handle in the process.** Each long-lived store object registers with `resettable()` on the line that creates it. A config reload that changes `storagePath` resets them all, and closes the open connections before a new one opens. A test lists the registered handles and every `.db` file name in `src/`, so a new store file cannot skip the reset unnoticed.
6. **Restore always creates a new space.** The new space is named `<name> (restored <date>)`. A restore never overwrites a folder, so a damaged or wrong backup cannot destroy data.
7. **Delete is a backup, then the registry entry, then the folder, and only in the web app.** The web app asks for the typed space name. The CLI and the `memory` tool can list, create, archive, unarchive and switch, and they refuse every other action with "Only the web app can delete a space." (the same for rename, backup and restore).
8. **Default and the active space cannot be archived or deleted.**
9. **Backups use `VACUUM INTO` for SQLite files.** A backup of the active space stays consistent while hosts write. Each backup holds a SHA-256 manifest and is checked before OMMS reports success.

## Alternatives rejected

- **A space segment in the container tag** (`omms_<space>_project_<hash>`). It touches about 35 to 40 call sites, needs a store-wide tag rewrite like the `opencode_` to `omms_` migration, and still leaves the profile, prompts and chats shared.
- **The active space in `omms.jsonc`.** The web app would rewrite the user's main config on each switch, and the space list would split across two files.
- **Restore over an existing space.** One wrong click could destroy the only good copy.
- **Close connections during a backup.** Host processes keep their own connections open, so a backup would race with them.
- **Delete from the agent tool.** A person must confirm a removal. A typed name in the web app does that.

## Consequences

Release note wording:

- OMMS has memory spaces. A new space starts empty with its own memories and user profile. The Spaces item at the top of the web app sidebar opens a page with one card for each space, and a tree lists them. The Default space is your existing store.

Positive:

- A user can start clean without losing anything, and switch back.
- The three hosts follow one active space from their next turn.
- No migration runs. Rolling back to an older version ignores `spaces.json` and uses the Default space.

Negative:

- A switch does not stop work already in progress. A turn that began before the switch can finish in the old space.
- A user can forget to switch. The Spaces tree mark and the `Active memory space:` line in every memory context block show the space each time.
- Every new store file must be reset on a switch. The coverage test fails until its author decides how.
- Spaces do not share memories. Moving or merging memories between spaces is a later change (`memory-space-transfer`).
