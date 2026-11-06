# Design

## Context

See proposal.md for the reason for this change. These facts about the current code decide the approach:

- Every store file except `skills.db` sits under `CONFIG.storagePath`: shards in `projects/` and `users/`, `metadata.db`, `user-profiles.db`, `cold-buffer.json`, `user-prompts.db` (prompts, capture retry queue, capture attempts, Claude capture cursor), `chats.db`, `import-ledger.db` and `ai-sessions.db`. `skills.db` uses `skillStoragePath` (ADR-036).
- Memory rows are separated by `container_tag` (`omms_user_<hash>`, `omms_project_<hash>`). The tag is built in `src/services/tags.ts` and parsed in `src/services/memory-scope.ts`. Six call sites match tags with `.includes()`. The user profile, prompts and chats do not use the tag.
- `refreshConfigIfChanged()` in `src/config.ts` re-reads config when a config file's mtime or size changes. Pi refreshes on `before_agent_start` (every turn). OpenCode V2 refreshes per turn in `src/v2/memory-bridge.ts`. Claude Code hooks call the web server, which refreshes after settings writes.
- A refresh reloads `CONFIG` but does not close open connections. `closeTursoAndInvalidateCaches()` in `src/services/turso/lifecycle.ts` closes the shard connections and resets the prompt, profile and AI session managers. It does not cover `chats.db` or the import ledger.
- `src/services/tag-prefix-migration.ts` already has `createVerifiedBackup` and `copyFilesWithVerification`, which copy store files and write a SHA-256 `manifest.json`.
- The web app supports `en`, `zh` and `ar`. The sidebar navigation is built in `web/src/lib/components/explorer/sidebar-main-nav.tsx`, and the sidebar reads `GET /api/web/status` through `useWebStatus`.

## Goals / Non-Goals

**Goals:**

- Separate stores with no change to existing data and no rewrite of container tags.
- One switch that every running process follows without a restart.
- A backup and restore path that never overwrites a store.

**Non-Goals:**

- Moving, merging, exporting or importing memories between spaces. Change 2 (`memory-space-transfer`) covers these.
- Linked read-only spaces. Change 2 covers these.
- A per-folder pin that keeps one repository on a fixed space. The user chose one global active space.
- Per-space embedding settings. All spaces use the global embedding config.

## Decisions

### D1. A space is a storage folder, not a tag segment

The space selects the value of `storagePath`. Every component that reads `CONFIG.storagePath` then uses the space folder without code changes.

Alternative considered: add the space to the container tag (`omms_<space>_project_<hash>`). That touches about 35 to 40 call sites, needs a store-wide tag rewrite like the `opencode_` to `omms_` migration, and still leaves the profile, prompts and chats shared. Rejected.

### D2. Resolve the active space inside config loading

`src/config.ts` resolves `storagePath` in this order:

1. A project config's `storagePath`. This project uses its own folder, and OMMS reports it as a custom folder.
2. The active space from `~/.omms/spaces.json`. Default resolves to the global `storagePath` (or `~/.omms/data`). Any other space resolves to `~/.omms/spaces/<id>/`.

Registry reading and path resolution go in a new pure module, `src/services/spaces/registry.ts`, which takes paths as arguments and does not import `CONFIG`. This keeps the `mock.module` config stubs in the tests working (see the testing rules in `CLAUDE.md`). `skillStoragePath` keeps pointing at the global storage path, so `skills.db` stays shared.

### D3. `spaces.json` joins the config refresh signature

`configSignature()` adds `~/.omms/spaces.json`. A switch rewrites that file, so every process that already calls `refreshConfigIfChanged()` notices the switch on its next turn. No new polling or IPC is needed.

Alternative considered: put `activeSpace` in `omms.jsonc`. Rejected. The web app's settings writer would then rewrite the user's main config on every switch, and the space list would be split across two files.

### D4. A switch closes every store handle in that process

When a refresh changes the resolved `storagePath`, the process awaits a new `resetStoreHandles()` before it serves the turn. It calls `closeTursoAndInvalidateCaches()` and also resets the `chats.db` handle and the import ledger handle. A test lists every module that opens a file under `storagePath` and checks that the reset covers it, so a future store file cannot be missed.

Work already running (a capture or a profile step) holds its own connection and finishes in the old space. This is allowed by the spec.

### D5. Atomic registry writes and a single writer path

All registry changes go through one function that reads, changes and writes `spaces.json` through a temporary file and a rename, with an exclusive lock file under `~/.omms/`. The web server, the CLI and the `memory` tool all call it. Readers never take the lock.

### D6. Backup reuses the verified-copy code and uses `VACUUM INTO` for open databases

The manifest and verified copy logic moves from `tag-prefix-migration.ts` into `src/services/spaces/backup.ts`. The tag migration then imports it from there, with no change in behaviour. Each SQLite database is copied with `VACUUM INTO`, which gives a consistent copy while other connections write. Other files are copied byte for byte. The manifest records each file's SHA-256, the space id and name, the OMMS version and the time.

Alternative considered: close all connections during the backup. Rejected, because other host processes keep their own connections open.

### D7. Restore always creates a new space

Restore checks the manifest, copies the files into a new folder, and adds a registry entry named `<name> (restored <date>)`. It never replaces a folder, so a damaged or wrong backup cannot destroy data. The user can switch to the restored space and then delete the old one.

### D8. Delete is backup, then remove

Delete runs D6 for the space, verifies the backup, removes the registry entry, then removes the folder. If removing the folder fails after the registry entry is gone, OMMS reports the leftover folder path and does not retry on its own.

### D9. The space line goes into the shared context header

`src/services/context.ts` builds the memory context block for all three hosts. The line `Active memory space: <name>` goes there once, so the three hosts stay in step.

### D10. Web API and UI

- `GET /api/web/status` adds `activeSpace: { id, name, customStoragePath }`. The globe item reads it through `useWebStatus`.
- New routes under `/api/spaces`: list, create, rename, switch, archive, unarchive, backup, delete, backups list and restore. They follow the same auth and loopback rules as the other web API routes.
- New `/spaces` route and `SpacesView`. `SpaceNavItem` is the first item in `sidebar-main-nav.tsx`, above Project memories. It uses the `SidebarNavLink` style and opens the switcher instead of navigating.
- After a switch, the page invalidates its memory, profile and chat queries.

### D11. CLI and memory tool

- `om-memory-system space list | status | create <name> | archive <name-or-id> | unarchive <name-or-id> | use <name-or-id>`.
- The `memory` tool `space` mode takes the same actions. Each one keeps all data, so an agent can organise spaces but cannot remove anything.
- Delete, rename, backup and restore exist only in the web app. Delete needs the typed name, so a person always confirms it.
- The Claude Code plugin tool forwards to the same CLI, so all three hosts get the same operations.

## Risks / Trade-offs

- [A switch while another process is mid-turn] → The turn finishes in the old space. The spec allows this, and the context line shows the space on the next turn.
- [The user forgets to switch] → The globe button and the context line show the active space every time. Change 2 adds moving memories by date range to fix mistakes.
- [A new store file is added later and is not reset on a switch] → The D4 test fails when a module opens a file under `storagePath` that the reset does not cover.
- [`VACUUM INTO` needs free disk space equal to each database size] → A full disk makes the copy fail. The backup then reports failure and removes the partial folder, as the spec requires.
- [The registry and the folders disagree after manual file changes] → An unknown active space falls back to Default with a visible warning. OMMS leaves folders under `~/.omms/spaces/` that are not in the registry alone.

## Migration Plan

No data migration. On first start after the upgrade, `spaces.json` does not exist and the Default space is active, so behaviour is unchanged. Rollback: install the previous version. It ignores `spaces.json` and `~/.omms/spaces/` and uses the global `storagePath`, which is the Default space.

## Open Questions

None.
