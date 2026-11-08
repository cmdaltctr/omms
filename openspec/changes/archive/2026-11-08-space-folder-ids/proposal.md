# Proposal

## Why

A space's folder is named after the space's first name. `Work` gets `~/.omms/spaces/work/`. After a rename to `Tech`, the folder is still `work`, so a person who opens `~/.omms/spaces/` later cannot tell what the folder holds. The derived id also blocks a valid new name: after `Work` is renamed, creating a new `Work` fails with "gives the same folder id". The edit dialog tries to explain this with "Only the name changes. The folder keeps its name.", which users read as a contradiction.

## What Changes

- A new space gets a random folder id, `space-` plus 10 lowercase letters and digits (for example `space-2sjlnd1x8q`). The id no longer comes from the name, so it never goes stale and never clashes with a name. The id still follows the current id rules, so older OMMS versions read the registry.
- Existing spaces keep their ids and folders. The Default space keeps the id `default` and its storage path. Nothing on disk is moved or renamed.
- Every space folder, the Default folder included, holds a `space.json` file with the id, the display name and the creation time. OMMS writes it when a space is created and rewrites it when the space is renamed. OMMS adds a missing file at start-up. The registry stays the source of truth; `space.json` is a label for people who browse the folders.
- The `id-taken` refusal goes away for new spaces, because a random id cannot follow from a name.
- The web app removes the note "Only the name changes. The folder keeps its name." from the edit dialog.
- Each space card gets an **Open folder** icon button in the action row. Its tooltip names the action and shows the folder path. Selecting it opens the folder in the system file manager (Finder, File Explorer, or the Linux default). The web server does this only for a request from the local machine.
- CLI and memory-tool output that names a space shows the display name first. Where it shows the id, the id follows the name.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-spaces`: new spaces get random ids; every space folder holds `space.json`; the derived-id clash refusal goes away; output names spaces by display name.
- `web-memory-spaces`: the card action row gains an Open folder button; the edit dialog drops the folder-name note.

## Impact

- `src/services/spaces/registry.ts`: `createSpace` makes a random id; `spaceIdFromName` and the `id-taken` code go unless restore or import still need them.
- `src/services/spaces/registry-store.ts`: writes `space.json` on create and rename; a start-up step adds missing files.
- `src/services/space-routes.ts`: a new loopback-only route that opens a space folder.
- `src/services/spaces/operations.ts`, `src/cli/space-command.ts`: name-first output.
- `web/src/lib/components/spaces/SpaceCard.tsx`, `SpaceEditDialog.tsx`, `web/src/lib/i18n/spaces.ts`.
- `docs/memory-spaces.md`, `docs/web-ui.md`, a new ADR for the id choice.
- No dependency changes. No change to Pi, OpenCode or Claude Code adapters beyond the shared output text.
