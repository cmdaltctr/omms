## Design: Skills failures paging and a skill-view table of contents

### Context

The paged-list module (`web/src/lib/components/paged-list/`) already serves every growing list on the Skills page: `usePagedList` for browser-held rows, `usePaging` plus `serverWindow` for server-paged ones, `PagedList` for the toolbar and footer. `skillFailures` replies with at most 50 groups and each group's latest 5 calls, so the groups are browser-held rows. The Failures section missed this pattern when it shipped and renders a bare `<ul>`; its placement above Recent turns came from the `failed-tool-call-details` spec.

The skill view has no section ids of its own; page-level sections (`skills-section-*`) belong to the Skills page, not the skill view.

### Decisions

1. **Failures moves below Recent turns.** The section order on the skill view becomes Uses, Mode, Proposals, History, Recent turns, Failures. Failures is the narrowest interest, so it reads last.
2. **Groups page in the browser.** `FailureGroups` keeps its one request and switches its `<ul>` for `usePagedList({ storageKey: "omms-list-skill-failures", items: groups, sorts: FAILURE_SORTS })` inside `PagedList`, exactly like `ProposalList`. The default page size is 5 (the module default), matching Recent turns; no `defaultPerPage` override. New sorts live in `web/src/lib/skills-sorts.ts` beside the others: Most calls (descending first, the reply's own default order), Last seen (descending first), Tool (A–Z) (ascending). The dialog, Explain failures control and empty sentence stay outside `PagedList`, per the long-list rule.
3. **A sections module owns the skill-view order.** `web/src/lib/skill-detail-sections.ts` lists each section's id and English title in page order. `SkillDetail` gives each section wrapper `id` and `scroll-mt-4`, matching the page sections' pattern; the ToC, the order test and the docs all read the one module.
4. **The ToC floats over the page.** `SkillToc` renders one icon button in a `fixed` column at the top end of the screen (`top-16` below the mobile bar, `md:top-3`, `z-20`, logical `end-3`), out of the page flow, so the top of the skill view keeps all its space and the back link keeps its own first line. Expanded, the list starts with **All skills** (the view's own `onBack`, so the ToC carries the way back too), then the section links from the sections module in a small card below the button; the same button minimises it (`aria-expanded`, translated accessible names "Show contents" / "Hide contents"). A section click scrolls with `scrollIntoView(JUMP)` and `flashAnchor` from `web/src/lib/settings-navigation.ts`, the same jump the sidebar uses. The collapsed or open choice persists in `localStorage` in a `try`/`catch`, like the paged-list view.
5. **Spec deltas modify the two affected requirements** rather than adding parallel ones: the placement sentence in "The skill view groups repeated failures" flips to below, and the fixed order in "A failure group shows its counts and sample" becomes the default of a reader-changeable sort. The ToC arrives as one added requirement.

### Risks and trade-offs

- A saved view under the new storage key does not exist yet, so every reader starts at 5 rows and Most calls; no legacy key is needed.
- The sticky control overlays content while it scrolls. It keeps a compact height, one row collapsed and at most six short links expanded, and sits at the end edge so it covers the least-read corner in every language.
- Section ids on the skill view must not collide with the page's `skills-section-*` ids or trip `revealPageAnchor`; they use the `skill-section-*` prefix, which that helper ignores.

### What stays out

- No server-side paging for groups: 50 rows is small, and the reply already carries each group's sample calls.
- No ToC on the Skills page itself: its sections are already reachable from the sidebar tree.
- No change to the groups route, the dialog or Explain failures.
