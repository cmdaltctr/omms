# ADR-043: The Default space name lives in the registry

- **Date:** 2026-11-07
- **Status:** Proposed
- **Deciders:** Aizat Hawari
- **Change:** [`rename-default-space`](../../openspec/changes/archive/2026-11-07-rename-default-space/proposal.md)

## Context

The Default space was the only space whose name could not change. The pencil dialog disabled its name field and the web app refused the rename. No spec or ADR recorded a reason for the lock. A user who keeps every memory in Default, or who wants a name that matches their work, had no way to change it.

Default also has no entry in `spaces.json`. `listSpaces` builds it on every call from the constants `DEFAULT_SPACE_ID` and `DEFAULT_SPACE_NAME`. So removing the rename guard alone would validate the new name and then change nothing.

## Decision

1. **The custom name is an optional top-level `defaultName` string in `spaces.json`, next to `activeSpaceId`.** Default keeps no entry in `spaces[]`. An older OMMS ignores the field; no version bump and no migration.
2. **Every surface reads the name through `listSpaces` and `resolveActiveSpace`.** Both fall back to "Default" when the field is absent or the file cannot be read. No surface keeps a second copy of the name. The id stays `default` and the store folder stays the global one.
3. **Saving the name "Default" (case-insensitive) removes the field.** This gives a one-step reset and keeps the file free of a value that equals the fallback.
4. **The name rules reuse the existing checks.** Length (1 to 60 characters) comes from `checkedName`; uniqueness without regard to case comes from `findByName`, which already goes through `listSpaces`, so the clash check covers Default with no new code.
5. **Rename stays web-only, as for every space** (ADR-041, decision 7). The CLI and the `memory` tool still refuse it.

## Alternatives rejected

- **A real `default` entry in `spaces[]`.** It changes the meaning of every loop over `spaces` (backup, delete, archive lists, the duplicate-id parse check) and needs a migration for existing files.
- **The name in the space-appearance file.** The context line, the CLI and the `memory` tool read the registry, not the look file, so each would need a second reader.
- **Keep the lock and document the reason.** No reason was ever recorded, and the lock blocked a named workflow for Default-only users.

## Consequences

Positive:

- The rename is reversible: renaming back to "Default" clears the stored name.
- An unreadable registry shows "Default", the same fallback every other space gets (they are hidden).
- Creating a space named like the renamed Default is refused by the existing name-clash check, and the reserved-id rule keeps the id `default` out of new spaces.

Negative:

- An older OMMS installed alongside rewrites `spaces.json` and drops the name. Default shows "Default" again. Accepted: the file stays valid and rollback is safe.
- Documents and chats that quote the old name "Default" go stale after a rename. Accepted: the id `default` stays valid everywhere, and lookup by name works with the new name.
- The name has exactly one home. A user who edits `spaces.json` by hand and breaks it loses the custom name until the file is fixed.
