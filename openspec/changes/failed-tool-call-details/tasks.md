## 1. Queries and routes

- [ ] 1.1 Write failing tests for the turn failures query: ordered by position, input cut at 20000 characters with `inputCut`, null error text kept, missing `skills.db` gives an empty list and stays missing
- [ ] 1.2 Write failing tests for the group query: same tool and first error line group together, different first lines split, null error groups by tool name, ranking-rule position filter, order by call count, latest 5 calls per group
- [ ] 1.3 Check that window functions work in the store's libSQL; pick them or the JavaScript fallback
- [ ] 1.4 Implement `src/services/skill-learning/failures.ts` until the tests pass
- [ ] 1.5 Add `GET /api/skills/turns/:id/failures` and `GET /api/skills/failures` in `skill-routes.ts`, with `invalid-args` for a bad id and `not-found` for a deleted turn; add route tests, including that nothing is logged

## 2. Web client

- [ ] 2.1 Add `FailedCall`, `FailureGroup` types and `turnFailures`, `skillFailures` calls to `web/src/lib/skills-api.ts`
- [ ] 2.2 Add `FailedCallsDialog.tsx` (calls list, "No error text recorded", 400-character clamp with **Show full input**, cut notice, **Copy**, load-error message)
- [ ] 2.3 Make the failed-count label in `TurnList.tsx` a button that opens the dialog and loads on open
- [ ] 2.4 Add `FailureGroups.tsx` and place it above Recent turns in `SkillDetail.tsx`; group row opens the dialog with its latest 5 calls
- [ ] 2.5 Add strings to `web/src/lib/i18n/skills.ts` for every supported language
- [ ] 2.6 Keep each new `.tsx` file at 500 lines or fewer; run `tests/file-size-ceiling.test.ts`

## 3. Docs and checks

- [ ] 3.1 Update `docs/skill-learning.md` and `docs/web-ui.md` with the dialog and the Failures section
- [ ] 3.2 Run `openspec validate failed-tool-call-details --strict`
- [ ] 3.3 Run `bun run ci:local`
- [ ] 3.4 Browser check at 1280 px and 390 px on a separate preview app (own port and store, never the 4747 app): open a turn dialog, open a group, check long input, check the no-error-text case, check RTL (Arabic)
- [ ] 3.5 Run `graphify update .`
