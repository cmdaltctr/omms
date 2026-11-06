# Proposal

## Why

All work goes into one store today. A fresh experiment or a separate line of work pulls in the 4,000+ memories and the learned user profile from everything else, and the user cannot start clean or keep the two apart. A named **space** gives the user separate stores and lets them pick the active one in a single place.

## What Changes

- Add memory spaces. A space is one storage folder with the same layout as today's store: memory shards, `metadata.db`, `user-profiles.db`, `user-prompts.db`, `chats.db` and `import-ledger.db`.
- The **Default** space is the existing store (the global `storagePath`, normally `~/.omms/data`). It stays where it is. No data moves and no migration runs.
- New spaces live in `~/.omms/spaces/<id>/`. A new space starts empty, with its own memories and its own user profile.
- `skills.db` stays global. All spaces share it.
- A registry file, `~/.omms/spaces.json`, records each space (id, name, created time, archived flag) and the one active space.
- One global active space. A switch applies to every host (Pi, OpenCode V2, Claude Code) and to the web app on their next turn or request. The process closes its open store connections before it opens the new folder.
- Every memory context block that OMMS adds to a session names the active space, so the agent and the user can see which store is in use.
- Web app: a `Spaces` item (globe) at the top of the sidebar, above Project memories, carries a tree of the spaces, like Memory. The active space is marked. A child opens that space's card.
- Web app: a new **Spaces** page lets the user add, rename, archive, unarchive, delete, back up and restore spaces.
- Archive hides a space from the sidebar tree and keeps its data. Delete makes a verified backup first, asks for confirmation, then removes the folder. The Default space and the active space cannot be deleted or archived.
- Backup copies a space folder into `~/.omms/backups/` with a checksum manifest. Restore checks the manifest before it replaces a space's folder.
- The `om-memory-system space` CLI command and a `space` mode on the `memory` tool list, create, archive, unarchive and switch spaces. Neither can delete a space. Only the web app deletes, after a backup and a typed confirmation. Pi, OpenCode V2 and Claude Code (through the tool and the CLI) get the same operations.
- Out of scope, planned as change 2 (`memory-space-transfer`): moving or merging memories between spaces by date range, export with an option to strip identifiers and with embedding runtime metadata, import as a new space with an embedding mismatch warning, and linked read-only spaces.

## Capabilities

### New Capabilities

- `memory-spaces`: the space registry, the folder per space, the active space and how every host and the web server resolve it, switching, archive, delete, backup, restore, the active-space line in memory context, and the CLI and `memory` tool operations.
- `web-memory-spaces`: the Spaces sidebar item and tree with the active-space mark, and the Spaces page with a card for each space.

### Modified Capabilities

None. The Default space keeps the current store path and behaviour, so existing requirements still hold.

## Impact

- **Code:** new `src/services/spaces/` module (registry, path resolution, backup and restore); `src/config.ts` (resolve the storage path from the active space when no config file sets `storagePath`, and add `spaces.json` to the refresh signature); `src/services/turso/lifecycle.ts` callers (close connections on a switch); `src/services/context.ts` (space line); `src/core/memory-operations.ts` (`space` mode); `src/cli/` (new `space` command); web API routes in `src/services/`; `web/src/` (sidebar Spaces item and tree, Spaces page, route, translations).
- **Hosts:** Pi extension and OpenCode V2 already refresh config each turn. They pick up the switch through that refresh. Claude Code hooks go through the web server, which handles the switch.
- **Data:** no change to existing data. New folders under `~/.omms/spaces/` and backups under `~/.omms/backups/`.
- **Docs:** a new guide for spaces, plus updates to the configuration guide, the CLI reference, the web UI guide, the `omms-memory` skill and `README.md`. ADR-041 records the design, and a TDR records each build finding.
- **Dependencies:** none.
