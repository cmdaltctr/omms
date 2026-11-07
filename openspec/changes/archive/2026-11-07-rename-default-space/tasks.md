# Tasks

## 1. Registry stores and applies the Default name

- [x] 1.1 Write failing tests in `tests/spaces-registry.test.ts`: rename of Default stores `defaultName`, `listSpaces` returns it, renaming to "Default" removes it, a name taken by another space is refused, length rules apply. Run `bash scripts/run-tests-isolated.sh tests/spaces-registry.test.ts` and confirm they fail on the current code.
- [x] 1.2 Add the optional `defaultName` field to `SpaceRegistry` in `registry.ts`. Make `listSpaces` use it, make `renameSpace` set or clear it for the Default id, and make `readRegistryFile` read it (ignore a non-string or empty value). Confirm the 1.1 tests pass.
- [x] 1.3 Add a round-trip test in `tests/spaces-registry-store.test.ts`: rename Default through `renameStoredSpace`, read the file back, and confirm the name and the other spaces are unchanged. Confirm the test fails if the field is not written.

## 2. Active space and hosts use the stored name

- [x] 2.1 Write failing tests in `tests/spaces-active.test.ts`: with `defaultName` set, `resolveActiveSpace` returns it when Default is active, and returns "Default" when the file is unreadable or missing. Confirm they fail first.
- [x] 2.2 Make the Default branch of `resolveActiveSpace` in `active-space.ts` use the registry name. Keep "Default" for the unreadable-file fallback. Confirm the 2.1 tests pass.
- [x] 2.3 Add a test in `tests/memory-context-space.test.ts` that the context line reads `Active memory space: Main` after the rename. Add a test in `tests/space-operations.test.ts` that `list` and `status` show the new name and that `rename` still returns "Only the web app can rename a space." for Default. Confirm both fail on the old code where they depend on the change.

## 3. Web route and edit dialog

- [x] 3.1 Write failing tests: in `tests/web-space-routes.test.ts`, the Default row has no `rename` entry in `disabled` and `POST /api/spaces/default/rename` returns the new name; in `web/tests/space-edit.spec.tsx`, the name field of Default is enabled and saving sends the rename. Update the assertion at line 262 that expects "The Default space cannot be renamed." Confirm they fail first.
- [x] 3.2 Remove the Default case from `disabledReasons` in `src/services/space-routes.ts`. Remove `spaces-why-default-rename` from `web/src/lib/i18n/spaces.ts` and from `KNOWN_WHY` in `web/src/lib/spaces-api.ts`. Confirm the 3.1 tests pass and `grep -rn "default-rename" web src tests` finds nothing.

## 4. Documentation

- [x] 4.1 Update `docs/memory-spaces.md` (registry section: the optional `defaultName` field, the fallback to "Default" when the file is unreadable, rename is web-only) and the pencil-dialog text in `docs/web-ui.md` or the guide that describes it. Verify with `grep -rn "cannot be renamed\|name is fixed" docs README.md` that no old statement remains, and run Prettier on the changed Markdown.

## 5. Gate

- [x] 5.1 Run `bun run ci:local` in this worktree after `bun install --frozen-lockfile` and `(cd web && bun install --frozen-lockfile)`, and read the real exit line. Run `openspec validate rename-default-space --strict`.
- [x] 5.2 Live check in a scratch HOME on its own port: rename Default in the web app, confirm the card, tree and status show the new name, restart, confirm it persists, rename back to "Default", confirm `defaultName` is gone from `spaces.json`.

## Workflow follow-up

- Run `openspec-verify-change`, then `openspec-archive-change` before the pull request.
- Ask the user before commit and push. Use a `feat:` Conventional Commit.
