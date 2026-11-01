# Tasks

## 1. Summary list on the server

- [x] 1.1 Add `src/services/skill-learning/proposal-summaries.ts` with the summary type, the named-column list query (same filters and order as `listProposals`) and a page line-count query that reads `diff`, and `proposed_content` only where `diff IS NULL`. Do not import `CONFIG`. Verify with a new `tests/skill-proposal-summaries.test.ts` that checks fields, order, filters, improvement counts and new-skill counts. Verify the tests fail before the module exists.
- [x] 1.2 Add an undo check in `apply.ts` that takes the state, the newest version's path and hash, the folders and the read-only flag. Make `planUndo` use it. Verify with `bash scripts/run-tests-isolated.sh tests/skill-learning-apply.test.ts tests/skill-learning-apply-state-failure.test.ts` that undo behaviour is unchanged.
- [x] 1.3 Make `withCanUndo` read the newest version of all applied ids in one query that names `proposal_id, path, written_hash`, then run the check. Verify with a test where a later apply rewrote the file: the first shows `canUndo` false, the second true.
- [x] 1.4 Make `GET /api/skills/proposals` and the proposals in `GET /api/skills/skill` return the summary shape. Keep `limit`, `offset` and `total`. Verify with a route test that fails when any listed proposal has `content` or `diff`, and that `GET /api/skills/proposals/:id` still returns both.
- [x] 1.5 Add the size-budget test: seed 500 proposals with 20 KB content, 300-character summaries and 30 evidence ids; assert the `GET /api/skills/proposals` body is under 600,000 bytes. Verify it fails on the current code.
- [x] 1.6 Make `skillHistory` read the summary columns, load diffs only for the entries on the page, and use the batched `canUndo`. Verify that `tests/skill-learning-history.test.ts` passes unchanged and that `tests/chat-skills-runtime.test.ts` passes.
- [x] 1.7 Update the API table in `docs/skill-learning.md` with the summary shape and the detail route. Verify by reading the section against the route code.

## 2. Skills tool and terminal

- [x] 2.1 Make the `proposals` operation in `src/core/skill-operations.ts` return summaries in `data.proposals` with unchanged text lines. Verify with a test on `runSkillsTool` mode `proposals`: no `content` or `diff` in the JSON, and mode `show` still returns both.
- [x] 2.2 Update the `proposals` row in `docs/cli.md` to say that `--json` lists summaries and `show` gives the content and diff. Verify by reading the row.

## 3. Web page

- [x] 3.1 Change `web/src/lib/skills-api.ts` to a summary type for lists and a detail type for `proposal(id)` and the action replies. Update `skills-model.ts` (`hasMoreDetail`, line counts from the summary). Verify with `bun run check`.
- [x] 3.2 Make `ProposalCard.tsx` fetch the detail once on **Show more**, show a loading line, and show an error with the buttons kept when the fetch fails. Keep the file at 500 lines or fewer; move the fetch into a `useProposalDetail` hook if it would pass. Verify with `tests/file-size-ceiling.test.ts`.
- [x] 3.3 Add a web spec in `web/tests/` that opens a card with **Show more** and finds the full diff and the evidence turns, and that a compact card makes no detail request. Verify it fails before 3.2.
- [x] 3.4 Add a test that `diffStat` in the web and the server line counts agree for the same diff and for a new skill.
- [x] 3.5 Add the new strings (loading line, load error) in English, Chinese and Arabic in `web/src/lib/i18n/skills.ts`. Verify with `tests/web-translations-parity.test.ts`.
- [x] 3.6 Update the proposal card text in `docs/web-ui.md`: the compact card uses list counts, **Show more** loads the full proposal. Verify by reading the section.
- [x] 3.7 Check the Skills page in the browser at 1280 px and 390 px: compact cards, **Show more**, **Apply**, **Reject** and **Undo**. Use `chrome-devtools`, or `orca-cli` if Chrome is missing. Record the result in the pull request.

## 4. Integration

- [x] 4.1 Run `bun scripts/measure-proposals-list.ts` and add the after-change numbers for cases 4, 4b and 5 to TDR-059. Verify that the list route at N = 5,000 is below 200 ms.
- [x] 4.2 Run `bun run ci:local` and `openspec validate skill-proposal-summaries --strict`. Both pass.

## Workflow follow-up

- Run the `openspec-verify-change` skill and fix its findings.
- Archive the change before the pull request.
- Phase 2 is not a task here. Start it as its own change when the trigger in design.md fires.
