# Proposal

## Why

Memory spaces (change 1, ADR-041) keep stores apart, but nothing crosses the gap. A memory saved in the wrong space stays there. A colleague cannot receive the memories of one line of work. A space that builds on another cannot read it. This change adds the missing paths between spaces.

## What Changes

- **Transfer.** Copy or move memories from one space to another, filtered by a date range and optionally by source project. A preview comes first: the count, the source projects, example memories and the count of exact duplicates that will be skipped. An apply step then writes. Copy leaves the source unchanged. Move removes a memory from the source only after the copy in the target is checked.
- **Duplicates.** A memory is skipped when its id already exists in the target, or when the target holds the same text under the same project tag. Near-duplicates are kept. The result reports the skipped count.
- **Surfaces.** Preview and copy work in the web app, the CLI (`om-memory-system space preview | copy`) and the `memory` tool `space` mode, with equal behaviour in Pi, OpenCode V2 and Claude Code. **Move works only in the web app**, after a confirm dialog, because it removes memories from the source.
- **Export.** Write one space to a file for a colleague. The file holds no vectors. It holds no absolute paths, user names or email addresses in any structured field, and OMMS replaces home-folder paths and email addresses it finds inside memory text. The user profile and the personal (user-scope) memories are left out unless the user ticks an opt-in box. Export works in the web app and the CLI.
- **Import.** Read an export file into a **new** space. Import never writes into an existing space. OMMS re-embeds every memory with the importing machine's embedding model, and warns when the file's model or dimensions differ. Project tags are kept by default, and the user can map all project memories onto one local project folder. Import works in the web app and the CLI.
- **Linked read-only spaces.** A space can list other spaces it reads but never writes. A search in the space also searches its linked spaces. Own-space results rank first. A linked result carries the name of its space. Link and unlink work in the web app, the CLI and the `memory` tool.
- The `Spaces` page gets Transfer, Export and Import controls and a Links section on each card. All new text exists in `en`, `zh` and `ar`.
- **Not changed:** the locked decisions. A space stays one storage folder. Restore and import create a new space. Delete stays in the web app with a typed name. The agent tool and the CLI never delete, rename, back up or restore. The Default space and the active space cannot be archived or deleted. Icons and `skills.db` stay global.

## Capabilities

### New Capabilities

- `memory-space-transfer`: preview, copy and move of memories between two spaces by date range and project, the duplicate rule, the verified-copy rule for move, and which surface may run which step.
- `memory-space-export-import`: the export file, what it strips and leaves out, the profile opt-in, and import into a new space with re-embedding and the model and dimension warning.
- `linked-memory-spaces`: the links of a space, read-only search across linked spaces, ranking, labels and the refusal to write.
- `web-memory-space-transfer`: the Transfer, Export, Import and Links controls on the Spaces page.

### Modified Capabilities

- `memory-spaces`: the registry entry gains a list of linked space ids, and the CLI and `memory` tool gain the preview, copy, link and unlink operations.
- `web-memory-spaces`: a card gains Transfer, Export and Links buttons.

## Impact

- **Code:** a space-bound store (`src/services/spaces/space-store.ts`) that opens one chosen space folder without touching `CONFIG.storagePath`, which needs the shard manager, the connection manager and the two lock modules to take their root folder as an argument; new pure transfer, export, import and link modules in `src/services/spaces/`; `src/services/client.ts` (linked search); `src/services/context.ts` (label); `src/services/space-routes.ts` and a transfer route module; `src/core/space-tool.ts`, `src/services/spaces/operations.ts` and `src/cli/space-command.ts`; the Pi, OpenCode V2 and Claude Code tool schemas; `web/src/lib/components/spaces/` and `web/src/lib/i18n/spaces.ts`.
- **Data:** `spaces.json` gains an optional `links` array per entry. An older file stays valid. A move changes two stores. No other store file changes shape.
- **Hosts:** all three read the same registry, so linked search and the new `space` actions reach every host through the shared core.
- **Docs:** `docs/memory-spaces.md`, `docs/cli.md`, `docs/web-ui.md`, the `omms-memory` skill and the `omms-design` skill. An ADR records the space-bound store and the link rules. A TDR records each build finding.
- **Dependencies:** none.
- **Risk:** the space-bound store changes shared store classes. See design D1.
