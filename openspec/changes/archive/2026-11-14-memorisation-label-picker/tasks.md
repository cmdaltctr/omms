## 1. Label counting and route

- [x] 1.1 Add `countLabels` to `src/core/memorisation.ts` with unit tests in `tests/memorisation-core.test.ts` (case merge, first spelling kept, `memorisation` tag dropped, count then name order, empty input); verify the tests fail without the function and pass with it
- [x] 1.2 Add `listMemorisationLabels` to `src/services/memorisation-store.ts` and route `GET /api/memorisations/labels` in `src/services/memorisation-routes.ts`; verify with a route test that counts match the three scenarios of "Label list route" and that linked-space records are counted
- [x] 1.3 Document the route in `docs/web-ui-memory.md` and verify the table row matches the route

## 2. Picker logic

- [x] 2.1 Add the pure helpers to `web/src/lib/memorisation-query.ts`: filter to groups, groups to filter, and the summary sentence; verify in `web/tests/memorisation-query.spec.ts` with a round trip (`server|reactjs`, `api` and back) and the empty case
- [x] 2.2 Add `labels()` to `web/src/lib/memorisation-api.ts` and a `setLabels` action to `useMemorisationLabels`; verify with a hook or view test that Apply writes the address without a new history entry

## 3. Picker UI

- [x] 3.1 Build the picker dialog under `web/src/lib/components/memorisation/` (groups, check boxes with counts, add and remove group, summary, Apply, Cancel, loading and error with **Try again**, stale labels ticked with count 0), following the omms-design skill and its references; verify in `web/tests/memorisation-view.spec.tsx` for each scenario of the web-memorisation delta
- [x] 3.2 Add **Filter by label** to `MemorisationView` and keep each file at 500 lines or fewer; verify `bun run check` and `tests/file-size-ceiling.test.ts` pass
- [x] 3.3 Add the English, Chinese and Arabic strings in `web/src/lib/i18n/memorisation.ts`; verify the i18n key-parity test passes

## 4. Docs and live check

- [x] 4.1 Update `docs/web-ui-memory.md` and `docs/using-memory.md` to describe the picker next to the typed syntax; verify the pages state that CLI and `memory` tool use the same groups
- [x] 4.2 Live check in a scratch HOME with the Orca browser at 1280, 820 and 390 px in English and Arabic: open, tick, add a group, Apply, Cancel, error state; verify no sideways scroll and the address, bar and list agree
- [x] 4.3 Run `bun run ci:local` and `openspec validate memorisation-label-picker --strict`; verify both exit 0

## Workflow follow-up

- Commit this change with the label OR work on `feat/recall-label-or` and push once, as the user asked for one worktree.
- Archive the change (`openspec-archive-change`) before the pull request, in the same pull request.
