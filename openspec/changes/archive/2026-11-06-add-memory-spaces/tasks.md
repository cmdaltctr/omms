# Tasks

## 1. Registry and path resolution

- [x] 1.1 Add `src/services/spaces/registry.ts` (pure, no `CONFIG` import): read and validate `spaces.json`, derive safe ids from names, enforce unique names and the reserved `default` id, and resolve a space's folder. Verify with a new `tests/spaces-registry.test.ts` covering a missing file, an invalid file, `../Team B` giving `team-b`, a duplicate name without regard to case, and the reserved id. Confirm that each test fails when its rule is removed.
- [x] 1.2 Add the atomic registry writer with a lock file (D5): create, rename, archive, unarchive and switch. Verify with tests for the archived-space and active-space refusals and for a concurrent-writer case, where two writers produce no lost update.
- [x] 1.3 Resolve `storagePath` from the active space in `src/config.ts` (D2), keep `skillStoragePath` on the global path, and add `spaces.json` to `configSignature()` (D3). Verify with config tests: no registry gives the Default space, a non-default active space gives `~/.omms/spaces/<id>/`, a project `storagePath` wins and is marked custom, an active space with a missing folder falls back to Default with a warning, and changing `spaces.json` triggers a refresh.

- [x] 1.4 Point the embedding model cache in `src/services/embedding.ts` at the global storage path (`CONFIG.skillStoragePath ?? CONFIG.storagePath`) instead of `CONFIG.storagePath`. Verify with a test: with a non-default active space, the cache folder is in the global path. Confirm the test fails on the old code.

## 2. Switching in running processes

- [x] 2.1 Add `resetStoreHandles()` (D4), which calls `closeTursoAndInvalidateCaches()` and resets the `chats.db` and import ledger handles. Call it when a refresh changes the resolved `storagePath`, before the turn is served. Verify with a test that switches spaces between two writes and finds each memory in its own space folder.
- [x] 2.2 Add a test that lists the modules that open files under `storagePath` and fails when `resetStoreHandles()` does not cover one. Verify that it fails after one reset is temporarily removed.
- [x] 2.3 Confirm that the Pi `before_agent_start` path and the OpenCode V2 per-turn path both reach the refresh and the reset. Verify with one adapter-level test per host that a switch made between two turns sends the second turn's search to the new space.

## 3. Memory context line

- [x] 3.1 Add the `Active memory space: <name>` line to the memory context block in `src/services/context.ts` (D9), with the custom-folder wording when a project sets `storagePath`. Verify with context tests for Default, a named space and a custom folder. Run `bash scripts/test-claude-mod.sh` to confirm that the Claude Code recall parser still reads the block.

## 4. Backup, restore and delete

- [x] 4.1 Move the manifest code from `createVerifiedBackup` in `tag-prefix-migration.ts` to `src/services/spaces/backup.ts` without changing its behaviour. Keep `copyFilesWithVerification`, `walkTree` and `timestampSlug` in `legacy-migration.ts` and import them. Verify that the existing tag-prefix migration tests pass unchanged.
- [x] 4.2 Back up a space with `VACUUM INTO` for SQLite files and verified copies for other files (D6). Skip the `.cache` folder. Remove the partial folder on failure. Verify with tests: a `.cache` folder is not in the backup, a backup taken during writes opens without error, a corrupted copy fails verification and leaves no folder, and the manifest holds the id, name and version.
- [x] 4.3 Restore a backup as a new space (D7). Verify with tests: a restore creates `<name> (restored <date>)`, an existing space stays byte-identical, a damaged file is refused with its name, and the active space does not change.
- [x] 4.4 Delete a space through backup, then registry, then folder (D8). Verify with tests: Default and the active space are refused, a failed backup keeps the space, and a successful delete returns the backup path.

## 5. CLI and memory tool

- [x] 5.1 Add `om-memory-system space list | status | create | archive | unarchive | use` in `src/cli/`, with no delete. Verify with CLI tests, including a refused switch to an archived or unknown space that lists the valid spaces, and a refused archive of the active space.
- [x] 5.2 Add the `space` mode (`list`, `status`, `create`, `archive`, `unarchive`, `use`) to `src/core/memory-operations.ts`, with no delete (D11). Verify that a delete action is refused with the web app message. Verify with operation tests, and check that the Pi tool, the OpenCode V2 tool and the Claude Code plugin tool (`hooks/omms-memory-tool.jsx`) accept the mode, through their existing tool tests and `bash scripts/test-claude-mod.sh`.
- [x] 5.3 Document spaces in a new `docs/memory-spaces.md` guide, add it to `docs/README.md`, update `docs/cli.md` and `docs/configuration.md` (`storagePath` and `spaces.json`), and add the `space` mode to the `omms-memory` skill. Verify that Prettier passes and that each documented command runs as written in a scratch HOME.

## 6. Web API

- [x] 6.1 Add `activeSpace` to `GET /api/web/status`, and add the `/api/spaces` routes (D10), with the existing auth and loopback rules. Verify with web server route tests for each action and for each refusal case in the `memory-spaces` spec.

- [x] 6.2 Save the icon of each space in `~/.omms/space-appearance/` through `PUT` and `DELETE /api/spaces/:id/appearance`, return a `look` for each space in `GET /api/spaces`, and move the host icons to the global folder so a switch does not hide them. Verify with route tests (set, replace, reset, refusals, removed on delete, kept after a switch) and a host-routes test that fails on the old code.

- [x] 6.3 Record `archivedAt` in the registry when a space is archived, clear it on unarchive, accept an older file without it, and return it as `archivedAt` (or null) in `GET /api/spaces`. Verify with registry and route tests that fail without the change.

## 7. Web UI

- [x] 7.1 Add the `Spaces` item (boxes icon) as the first sidebar item above Project memories, with a `ProfileTree`-style tree of the spaces that are not archived (chip, name, active mark), on desktop and in the narrow-screen sidebar menu. A child opens that space's card and never switches. Verify with component tests for the collapsed sidebar, a long name, the active mark after an outside switch, a custom folder, and a click that leaves the active space unchanged.
- [x] 7.2 Add the `/spaces` route and `SpacesView` as a grid or list of cards in the Memory page design, with a view toggle. Each card has an avatar, name, state line, size and date, an Activate play button (none on the active card), a success outline on the active card, and icon-only archive or unarchive, back up and delete buttons with tooltips that name the action or give the reason. Make Activate, archive, unarchive and back up (and Activate after a create) open a `SpaceConfirmDialog` first, with progress and the server error inside the dialog, and give every enabled control a pointer cursor. Add the create form, the delete dialog that requires the typed name, and the backups list with Restore as new space. After a switch, reload the memory, profile and chat queries. Verify with component tests for each scenario in the `web-memory-spaces` spec, including a failed switch, Cancel on each confirmation, and a refused request.
- [x] 7.5 Add the pencil on each card with the Change icon dialog (display name, upload, search icons, reset) shared with the host cards, show the avatar on the card and in the tree, and use the Boxes icon for the Spaces item. Verify with component tests for rename and icon save, the fixed Default name, and the avatar in the tree.
- [x] 7.6 Add the Archive child (layers icon, last in the tree) and the `/spaces/archive` page: a list of archived spaces in the style of the Backups list (paged toolbar, newest archived first, one card each) with avatar and name, archived and created dates ("not recorded" when absent), size, and Restore (confirmed), Back up and Delete; an empty state; and show only non-archived spaces as cards on the Spaces page. Verify with component tests for the scenarios in the `web-memory-spaces` spec and for the `archivedAt` date.
- [x] 7.3 Add every new string in `en`, `zh` and `ar`. Verify with the existing translation completeness test.
- [x] 7.4 Update `docs/web-ui.md` with the Spaces sidebar tree, the cards, the pencil dialog and the view toggle.

## 8. Decision records, docs and README

- [x] 8.1 Write ADR-041 "A memory space is a storage folder" in `docs/adr/`. Record D1 (folder, not tag), D3 (`spaces.json` outside `omms.jsonc`), D7 (restore creates a new space) and D11 (agent and CLI cannot delete). List the rejected options. Add it to `docs/adr/ADR_README.md`. Verify that every link in the record resolves.
- [x] 8.2 Write one TDR in `docs/tdr/` (next free number, 063 at planning time) for each workaround or debugging finding met during the build. Examples are a store handle that the switch did not close, or a `VACUUM INTO` limit. Add each TDR to `docs/tdr/README.md`. If there were none, record that in the pull request description. Verify that the index links resolve.
- [x] 8.3 Check the docs that groups 5 and 7 changed against the final behaviour: `docs/memory-spaces.md`, `docs/cli.md`, `docs/configuration.md`, `docs/web-ui.md`, `docs/README.md` and the `omms-memory` skill. Grep `docs/` for `storagePath` and `~/.omms/data`, and update each hit that assumes one store. Verify with Prettier and by running each documented command in a scratch HOME.
- [x] 8.4 Add one line on spaces to `README.md` under "Inside OMMS", with a link to `docs/memory-spaces.md` in the Documentation list. Keep the README short. Verify with Prettier and that the link resolves.
- [x] 8.5 Update `CONTRIBUTING.md` and `CLAUDE.md` only if a command or a store-path rule changed (for example, the rule that every store file sits under `storagePath`). Verify with Prettier, or record "no change needed" in the pull request description.

## 9. Integration checks

- [x] 9.1 Run a live check in a scratch HOME on its own port: create `Experiments`, switch from the web app, run one Pi turn and one Claude Code turn, and confirm that both capture into `Experiments`. Confirm that the context line names the space and that Default stays unchanged. Check the Spaces page at desktop and at 390 px width.
- [x] 9.2 Run `bun run ci:local` and `bash scripts/test-claude-mod.sh`, and confirm that both pass.
- [x] 9.3 Run `openspec validate add-memory-spaces --strict` and confirm that it passes.

## Workflow follow-up

- Run `/opsx:verify`, then archive the change before the pull request.
- Ask the user before committing, pushing or opening the pull request.
