## 1. Shared ground

- [x] 1.1 Add the new strings to `web/src/lib/i18n/skills.ts` for every supported language: the three sort labels, the failure-group count labels, and the ToC labels
- [x] 1.2 Add `skill-detail-sections.ts` with the skill-view sections in page order: Uses, Mode, Proposals, History, Recent turns, Failures

## 2. Failures list

- [x] 2.1 Write failing tests for `FAILURE_SORTS` in `web/src/lib/skills-sorts.ts`: Most calls descending first, Last seen descending first, Tool ascending, and the default sort is Most calls
- [x] 2.2 Write a failing order test that reads `SkillDetail.tsx` and asserts the sections render in the sections-module order, with Recent turns before Failures
- [x] 2.3 Add `FAILURE_SORTS` to `skills-sorts.ts` until the sort tests pass
- [x] 2.4 Convert the groups list in `FailureGroups.tsx` to `usePagedList` + `PagedList` (storage key `omms-list-skill-failures`, default 5 per page); keep the dialog, Explain failures control and the empty sentence outside the pager
- [x] 2.5 Move the Failures section below Recent turns in `SkillDetail.tsx`

## 3. Skill-view table of contents

- [x] 3.1 Write a failing test for the sections module: order, ids prefixed `skill-section-`, titles that exist in the i18n table
- [x] 3.2 Add `SkillToc.tsx`: sticky top-end control, one icon button that expands and minimises, section links that jump with `scrollIntoView` and `flashAnchor`, choice persisted in `localStorage` with `try`/`catch`
- [x] 3.3 Give each skill-view section its `id` and `scroll-mt-4`, and mount `SkillToc` as the first child of the skill view

## 4. Design skill and docs

- [x] 4.1 Update the omms-design references (repository canonical copy and the installed copy): every list that can grow past 5 rows, including the failure groups, uses the shared pager at the default size; the skill-view section order; the sticky ToC pattern
- [x] 4.2 Update `docs/skill-learning.md` and `docs/web-ui.md`: Failures after Recent turns, the paged toolbar, the ToC

## 5. Checks

- [x] 5.1 `openspec validate skills-failures-paging-toc --strict`
- [x] 5.2 `bun run check` and the focused tests through `scripts/run-tests-isolated.sh`
- [x] 5.3 `bun run ci:local`
- [x] 5.4 Browser check at 1280 px and 390 px in Orca on a seeded preview app (own port and store, never the 4747 app): Failures below Recent turns, pager with 5 rows default and sorts, ToC expand, minimise, jump and persistence, Arabic layout
- [x] 5.5 `graphify update .` when a graph exists in the worktree

## 6. The floating contents on the other long pages

- [x] 6.1 Extract the floating shell into the shared `PageToc` (`web/src/lib/components/PageToc.tsx`); the skill view keeps its own back entry and storage key
- [x] 6.2 Mount `PageToc` on the Settings page (`omms-settings-toc-open`, the settings sections, no back entry) and give the list a height cap
- [x] 6.3 Mount `PageToc` on the Skills list view (`omms-skills-toc-open`, the page sections, only while no skill is open)
- [x] 6.4 Add the web-settings spec delta and the Skills-page requirement; update omms-design and `docs/web-ui.md`
- [x] 6.5 `bun run check`, the focused tests and `bun run ci:local`
- [x] 6.6 Browser check of both new mounts in Orca at 1280 px and 390 px, including Arabic
