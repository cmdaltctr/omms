# Tasks

Write each test first and prove it fails on the current code before the fix. Run one file with `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`.

## 1. Space-wide reads

- [x] 1.1 In `tests/memorisation-store.test.ts`, add failing tests: `getMemorisationById(id, null, linked)` finds a row of another project, and `deleteMemorisation(id, null, linked)` deletes it. Make `memorisation-store.ts` accept `null` for any project, and verify the tests pass.
- [x] 1.2 In `tests/memory-operations-memorise.test.ts`, add failing tests: recall by ID, by text and by labels finds a memorisation saved under another project tag in the same space, and an ID that exists only in an unlinked space stays "not found". Switch `runRecall` to scope `"all-projects"` with an empty tag, and verify the tests pass.
- [x] 1.3 In `tests/memorisation-routes.test.ts`, add failing tests: with the web server's `cwd` set to a folder with no project, `GET /api/memorisations`, `GET /api/memorisations/recall` and `POST /api/memorisations/bulk-delete` reach a memorisation of another project. Stop the routes from deriving a project tag, and verify the tests pass.
- [x] 1.4 Update `docs/using-memory.md` ("Memorise and recall") and `docs/web-ui-memory.md` ("Memorisation page") to say memorisations belong to the space, not the project. Grep `docs/` and `README.md` for "current project" next to memorisation and fix every hit. Verify with Prettier on the changed files.

## 2. Project label on save

- [x] 2.1 In `tests/memorisation-core.test.ts`, add failing tests for a pure helper that merges the normalised project name into the caller's labels: no repeat when the caller gave it, no label for the name `/`. Add the helper to `src/core/memorisation.ts`, and verify the tests pass.
- [x] 2.2 In `tests/memory-operations-memorise.test.ts`, add a failing test that `memorise` stores the project label and returns it in its reply. Call the helper from `runMemorise`, and verify the test passes.
- [x] 2.3 In `tests/memorisation-labels-tool-parity.test.ts`, add a failing case that OpenCode V2, Pi, Claude Code and the CLI all store the same project label for the same folder. Verify it passes with no adapter change.
- [x] 2.4 Describe the project label in `docs/using-memory.md`: what the name is for a worktree and for a folder outside git, and that older memorisations keep their labels. Verify with Prettier.

## 3. Rerank setting for memorisation recall

- [x] 3.1 In `tests/memorisation-settings.test.ts`, add failing tests: `memorisationRerank` defaults to `false`, accepts only booleans, and a project config cannot set it. Add the key to `src/core/memorisation-settings.ts`, `src/config.ts`, `src/config-template.ts`, `src/services/global-config-writer.ts` and `src/services/settings-snapshot.ts`, and verify the tests pass. Also confirm with a test that an unknown config key is ignored at load, so an older OMMS keeps working with this key in its config.
- [x] 3.2 In `tests/reranker-settings.test.ts`, add failing tests for `rerankSettingsFor(config, override)`: `false` gives no reranker even with `rerankerEnabled: true`, `true` gives one only when the URL and model are set, and no override keeps the current rule. Add it to `src/services/reranker.ts`, change the one line in `client.ts`, add `reranker` to `MemoryReadOptions`, and verify the tests pass and `client.ts` stays at 500 lines or fewer.
- [x] 3.3 In `tests/memorisation-recall-confidence.test.ts`, add failing tests: with reranking on, recall keeps the reranker's order and each match's content-only confidence, and the strong-match rule reads the first two in that order. With reranking off, `rerankerEnabled: true` does not change the order. A reranker failure returns the confidence order and logs one code with no text. Pass the override from `runRecall`, skip the confidence sort when it is `true`, and verify the tests pass.
- [x] 3.4 Document `memorisationRerank` in `docs/configuration.md` ("Memorisation"): default, global only, needs the reranker server, experimental. Verify with Prettier.

## 4. Web settings switch

- [x] 4.1 In `web/tests/memorisation-view.spec.tsx`, add failing specs: the switch saves `memorisationRerank` through `/api/settings` and survives a reload, a failed save returns the switch to its earlier position and shows the server's reason, and with no reranker model the switch is disabled with a tooltip and an `aria-describedby` reason. Add `RerankSwitch.tsx`, wire it in `MemorisationSettings.tsx` and `useMemorisationSettings.ts`, and verify the specs pass.
- [x] 4.2 Add every new string in English, Chinese and Arabic, and verify `tests/web-translations-parity.test.ts` passes.
- [x] 4.3 Break the disabled-state check on purpose once and confirm the spec in 4.1 fails, then restore it.
- [x] 4.4 Describe the switch in `docs/web-ui-memory.md` ("Memorisation page", settings), and add the switch pattern to the `omms-design` skill reference if it is new there. Verify with Prettier.

## 5. Decision record

- [x] 5.1 Write `docs/adr/049-memorisations-belong-to-the-space.md` (design decisions 1, 3, 5 and 6), mark ADR-047 decisions 5 and 12 as superseded by ADR-049, and add ADR-049 to `docs/adr/ADR_README.md`. Verify with Prettier.

## 6. Integration checks

- [x] 6.1 Run `bun run check` and `bun run build`, and verify both exit 0.
- [x] 6.2 Live check in a scratch HOME with its own port and store (never port 4747): start the web app in `/`, memorise from two different git repositories and from a worktree, then confirm the Memorisation page lists all three with their project labels, recall by ID works from the other repository, and the rerank switch is disabled without a reranker server.
- [x] 6.3 Run `bash scripts/test-claude-mod.sh` and verify it passes.
- [x] 6.4 Run `bun run ci:local` and verify the final line reports exit 0.

## Workflow follow-up

- Run `openspec-verify-change`, then archive with `openspec-archive-change` before the pull request.
- Ask the user before commit, push and pull request. Do not merge without the user's word.
- Run `graphify update .` after the code changes.
