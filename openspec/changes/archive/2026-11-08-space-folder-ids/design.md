# Design

## Context

`createSpace` in `src/services/spaces/registry.ts` derives the id from the name with `spaceIdFromName` and refuses with `id-taken` when another space has that id. The folder is `~/.omms/spaces/<id>/` (`resolveSpaceFolder`). Restore and import both create spaces through `createStoredSpace`, so they inherit the id rule. Commands and the `memory` tool already find a space by id or by name without regard to case (`findSpace`), so users never need to type an id. The id shows in folder names, `spaces.json`, backup folder names and logs.

The web server already treats loopback requests specially (`isLoopbackAddress` in `src/services/web-server.ts`). Card actions use `SpaceActionButton`, which gives an icon-only button a tooltip.

## Goals / Non-Goals

**Goals:**

- A folder name that can never disagree with the space's name.
- A way to find out what a folder holds without opening OMMS.
- A one-click way from a card to the folder on disk.
- Output that names spaces the way the user does.

**Non-Goals:**

- Renaming or moving existing folders. Existing ids stay.
- Changing the Default space's id or storage path.
- Reading `space.json` to find or name spaces. The registry stays the source.
- Opening folders for a web server reached over the network.

## Decisions

### 1. Random id: `space-` plus 10 base-36 characters

Drawn with `crypto.randomInt` over `a-z0-9`. 36^10 is about 3.7 × 10^15, so a clash is practically impossible; the code still redraws when the id is in the registry or the folder exists, so a clash cannot corrupt data. The result fits the existing id pattern (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 40 characters), so an older OMMS reads a newer registry unchanged.

Alternatives: a UUID (36 characters, fits, but long in paths and logs); a readable id with a `-2` suffix on clash (fixes the clash but keeps stale folder names, which is the problem the user raised).

### 2. `space.json` is a label, written but never read for behaviour

Content: `{ "id", "name", "createdAt" }`, written with the temp-file-then-rename pattern already used for `spaces.json`. Written on create, on rename (including the Default rename that sets `defaultName`), and at start-up for any folder that lacks it or holds a stale name. OMMS never reads it to decide anything, so a hand-edited or broken file cannot change behaviour. A write failure is logged and does not fail the create or rename, because the registry change is what counts.

The start-up pass writes one small file per space folder and changes nothing else, so the "do not move, copy or rewrite existing files" rule for upgrades holds for the store files.

### 3. Open folder: a loopback-only POST route

`POST /api/spaces/:id/open-folder`. The route checks the remote address with `isLoopbackAddress`, looks the id up in the registry, resolves the folder with the same function the store uses, checks the folder exists, then starts the platform opener with `execFile` and an argument array (no shell): `open <folder>` on macOS, `explorer <folder>` on Windows, `xdg-open <folder>` elsewhere. It returns at once and does not wait for the file manager. The path never comes from the request, only from the registry, so the route cannot open an arbitrary path.

The card's tooltip shows "Open folder" and the path. The path comes from the existing spaces list response; a `folder` field is added if the list does not carry it yet.

Alternative: show the path with a copy button only. Rejected: the user asked for a button that opens the folder.

### 4. Name-first output

`summary()` in `operations.ts` already returns both `id` and `name`. The CLI text formatter and the tool's text reply print `Name (id)` instead of an id alone. JSON output keeps both fields unchanged.

### 5. Remove the dialog note

Delete `spaces-edit-name-note` from all three languages in `web/src/lib/i18n/spaces.ts` and its use in `SpaceEditDialog.tsx`. The Open folder button now answers "where is this stored?".

## Risks / Trade-offs

- Random ids are less readable in logs and backup folder names → output prints the name next to the id, and `space.json` names each folder.
- Two id styles coexist (old readable, new random) → harmless; both follow the same pattern and nothing parses the id.
- An older OMMS renames a space and leaves `space.json` stale → the next start-up of a newer OMMS rewrites it.
- `xdg-open` is missing on some Linux systems → the route returns the error and the card shows it.
- Opening a folder starts a process from the web server → limited to loopback requests and registry folders, with no shell.

## Migration Plan

None needed. New spaces get random ids; existing spaces are untouched. Rollback is a code revert: random ids remain valid ids for the old code.

## Open Questions

None.
