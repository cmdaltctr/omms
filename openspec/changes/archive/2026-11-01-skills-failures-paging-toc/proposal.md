## Proposal: Skills failures paging and a skill-view table of contents

### Why

The Failures section shipped in `failed-tool-call-details` sits above Recent turns and renders every group in a plain list. The reader expects Failures after Recent turns, with the same paged toolbar (page size 5, sort, footer) that Recent turns and every other growing list on the page already use. The skill view is also long enough to need a table of contents: its sections start below the fold and reaching Mode or Proposals from Failures means a long scroll.

### What changes

- Move the Failures section below Recent turns on the skill view.
- Page the failure groups with the shared paged list: 5 rows by default, the size menu, and sorts (Most calls first as default, Last seen, Tool (A–Z)), with the standard footer.
- Add a small sticky table-of-contents control at the top end of the skill view: one icon that expands into the section list, minimises again on click, and jumps to a section with the same instant scroll and momentary outline the sidebar uses. The expanded or minimised choice persists per browser.
- Record both patterns in the omms-design skill (shared pager for every growing list, skill-view section order, sticky table of contents) so later changes follow them.

### Impact

- `web/src/lib/components/skills/FailureGroups.tsx`, `SkillDetail.tsx`, `web/src/lib/skills-sorts.ts`, a new `SkillToc.tsx` and a new sections module; new strings in `web/src/lib/i18n/skills.ts`.
- `docs/skill-learning.md` and `docs/web-ui.md` describe the section order and the new controls.
- `.agents/skills/omms-design/references/` (docs only).
- No server, store or host changes; the groups route reply stays as it is.
