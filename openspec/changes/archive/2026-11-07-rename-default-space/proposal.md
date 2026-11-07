# Proposal

## Why

The Default space is the only space whose name is locked. The pencil dialog disables the name field and the web app refuses the rename. A user who keeps all memory in Default, or who wants a name that matches their work, has no way to change it. The lock has no recorded reason in the specs or ADRs.

## Changes

- Allow the web app to rename the Default space. The id stays `default` and the folder stays the global store.
- Store the custom name in `spaces.json` as an optional `defaultName` field. Today Default is not stored at all: `listSpaces` builds it on every call with the fixed name "Default". Without a stored name, a rename would pass validation and change nothing.
- Use the stored name everywhere the active space is named: the card, the sidebar tree, the status line, the `Active memory space:` line in memory context for Pi, OpenCode V2 and Claude Code, and CLI and `memory` tool listings.
- Fall back to "Default" when `spaces.json` is missing or unreadable, because that file is the only place the name lives.
- Keep rename web-only. The CLI and the `memory` tool still refuse it.
- Enable the name field in the Default pencil dialog and remove the "cannot be renamed" reason.
- Renaming Default back to "Default" removes the stored name.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-spaces`: a new requirement for a stored, optional display name of the Default space, with the fallback and name-clash rules.
- `web-memory-spaces`: the pencil dialog lets the user edit the Default name. The "Default name is fixed" scenario is replaced.

## Impact

- Code: `src/services/spaces/registry.ts` (registry shape, `listSpaces`, `renameSpace`, file parsing), `src/services/spaces/active-space.ts`, `src/services/space-routes.ts`, `web/src/lib/components/spaces/SpaceEditDialog.tsx`. `src/config.ts` and `src/services/context.ts` keep "Default" only as a start-up value and a mock fallback; the real name comes from `resolveActiveSpace`.
- Tests: `tests/spaces-registry.test.ts`, `tests/spaces-active.test.ts`, `tests/web-space-routes.test.ts`, `tests/memory-context-space.test.ts`, `web/tests/space-edit.spec.tsx` (line 262 asserts the old reason).
- Docs: `docs/memory-spaces.md`, the web UI guide that describes the pencil dialog.
- File format: `spaces.json` gains one optional field. No version bump. An older OMMS ignores the field. An older OMMS that rewrites the registry drops the name, so Default shows "Default" again.
- Overlap: the unmerged `feat/space-transfer` worktree also edits the spaces registry. Whoever merges second rebases.
