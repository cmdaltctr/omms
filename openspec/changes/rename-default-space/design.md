## Context

See proposal.md for the motivation. Current state, read from the code:

- `spaces.json` lists user-created spaces only. `listSpaces` adds a Default entry on every call from the constants `DEFAULT_SPACE_ID` and `DEFAULT_SPACE_NAME` (`registry.ts`).
- `renameSpace` throws for the Default id. Its update step searches only the stored spaces, so removing the guard alone would do nothing.
- `resolveActiveSpace` (`active-space.ts`) builds the active space for config loading. Its Default branch uses `DEFAULT_SPACE_NAME`. That branch also serves every fallback: no file, unreadable file, unknown active id, missing space folder.
- `readRegistryFile` returns `emptyRegistry()` for an unreadable file, so all user spaces disappear from view until the file is fixed.
- The rename route calls `config.refreshConfigIfChanged`, which is how running hosts follow a rename on their next turn.
- `disabledReasons` in `space-routes.ts` marks rename as blocked for Default, and the pencil dialog reads that flag.

## Goals / Non-Goals

**Goals:**

- A renamed Default shows the new name on every surface that already shows the active or listed space name, with no new code path per surface.
- The change is reversible by renaming back to "Default".

**Non-Goals:**

- No change to the id `default`, the global store folder, or the rules for archive and delete of Default.
- No rename from the CLI or the `memory` tool. Those stay web-only.
- No second copy of the name outside `spaces.json`. Default avatar choices already live outside the registry and stay there.

## Decisions

### D1. Store the name as an optional top-level `defaultName` in `spaces.json`

Default is not an entry in `spaces`, so the name needs its own place. A top-level optional string sits next to `activeSpaceId`, is ignored by older versions, and needs no migration. `listSpaces` and `resolveActiveSpace` read it and fall back to `DEFAULT_SPACE_NAME`.

Alternatives considered:

- Write a real `default` entry into `spaces[]`. This changes the meaning of every loop over `spaces` (backup, delete, archive lists, parse checks for duplicate ids) and needs a migration for existing files. Rejected.
- Store the name in the avatar/look file that already sits outside the registry. The context line, CLI and `memory` tool read the registry, not the look file, so they would need a second reader. Rejected.

### D2. Treat the original name as "no custom name"

Saving the name "Default" (case-insensitive match to the constant) removes `defaultName` instead of storing it. This gives a one-step reset and keeps the file free of a value that equals the fallback.

### D3. Name checks stay in one place

`renameSpace` already checks length and uniqueness through `checkedName` and `findByName`, and `findByName` goes through `listSpaces`. Once `listSpaces` returns the custom name, the clash check covers Default with no new code. A user who renames Default and then creates a space called "Default" is refused by the existing reserved-id rule, because the derived id is `default`. That message stays as it is.

### D4. An unreadable registry shows "Default"

The name has one home. If `spaces.json` is unreadable, `readRegistryFile` already falls back to an empty registry and sets `problem`, and the web app status shows that problem. Showing "Default" in that state is the same fallback every other space gets (they are hidden). No backup copy of the name is kept.

### D5. Remove the blocked-rename reason for Default

`disabledReasons` stops returning `"default"` for rename. The edit dialog needs no new code, because it already enables the name field when no reason is present. The unused text `spaces-why-default-rename` (`web/src/lib/i18n/spaces.ts`) and its entry in `KNOWN_WHY` (`web/src/lib/spaces-api.ts`) are removed.

## Risks / Trade-offs

- [`feat/space-transfer` also edits the registry and may conflict] → Keep this change to the smallest edits in `registry.ts` and `active-space.ts`, and rebase whichever branch merges second.
- [An older OMMS installed alongside rewrites `spaces.json` and drops `defaultName`] → Accepted. The name falls back to "Default". Rollback is safe, and the file stays valid.
- [A user names Default the same as a name they later want for a new space] → The clash message names the existing space, which tells them what to do.
- [Documents and chats that quote the old name "Default" go stale after a rename] → Accepted. The id `default` stays valid in the CLI and `memory` tool, and name lookup works with the new name.

## Migration Plan

No data migration. Existing files have no `defaultName`, so Default keeps its name. Rollback: install the previous version. It ignores the field.
