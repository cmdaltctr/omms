# Tasks

## 1. Random space ids

- [x] 1.1 Write failing tests in the registry tests: a new space id matches `^space-[a-z0-9]{10}$`; `Work` then rename to `Tech` then create `Work` succeeds; an existing registry id `work` is kept; a drawn id that is already taken is redrawn (inject the random source).
- [x] 1.2 Change `createSpace` in `src/services/spaces/registry.ts` to draw the id; remove `spaceIdFromName` and the `id-taken` branch if nothing else uses them, and update `restore.ts` and `space-routes.ts` that mention `id-taken`.
- [x] 1.3 Check restore and import tests still pass and that their new spaces get random ids.

## 2. space.json label

- [x] 2.1 Write failing tests: create writes `space.json` with id, name and createdAt; rename rewrites it; Default rename writes it into the Default storage folder; start-up adds a missing file and fixes a stale name; a broken file does not change the listed name; a write failure does not fail the rename.
- [x] 2.2 Add a small module in `src/services/spaces/` that writes the label atomically, and call it from `registry-store.ts` create and rename paths.
- [x] 2.3 Add the start-up pass where the registry is first read, without touching any other file in the folder.

## 3. Open folder route

- [x] 3.1 Write failing route tests: a loopback request for a known id starts the opener with the folder from the registry; a non-loopback request is refused and starts nothing; an unknown id is refused; a missing folder returns an error; the opener is called with an argument array per platform (inject the process starter).
- [x] 3.2 Add `POST /api/spaces/:id/open-folder` in `src/services/space-routes.ts`, and a `folder` field to the spaces list response if it is missing.

## 4. Web card and dialog

- [x] 4.1 Write failing web tests: each card has an Open folder icon button whose tooltip shows "Open folder" and the path; selecting it posts to the route; an error shows on the card; the edit dialog no longer contains the folder note.
- [x] 4.2 Add the button to `SpaceCard.tsx` with `SpaceActionButton` and a folder icon; add strings in all three languages in `web/src/lib/i18n/spaces.ts`.
- [x] 4.3 Remove `spaces-edit-name-note` from `SpaceEditDialog.tsx` and from every language.

## 5. Name-first output

- [ ] 5.1 Write failing tests for CLI `space list` and the `memory` tool space replies: each line starts with the display name, the id follows.
- [ ] 5.2 Update the text formatters; keep JSON output unchanged.
- [ ] 5.3 Check the Pi and OpenCode tool replies use the same shared formatter, so all hosts change together.

## 6. Docs and records

- [ ] 6.1 Update `docs/memory-spaces.md` (random ids, `space.json`, Open folder) and `docs/web-ui.md` (remove the folder-name sentence, add the button).
- [ ] 6.2 Write an ADR for random space ids and add it to the ADR index.

## 7. Verify

- [ ] 7.1 Run `bun run ci:local` and read the exit line.
- [ ] 7.2 Live check in a scratch HOME on a free port: create `Work`, rename to `Tech`, create `Work` again, open each folder from the card, read each `space.json`.
- [ ] 7.3 Run `openspec validate space-folder-ids --strict`.
