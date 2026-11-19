# Design

## Context

`SettingsView.tsx` renders all 15 cards from `SETTINGS_SECTIONS`, each in a `div` whose `id` is the section anchor, and mounts `PageToc`. Every link to a card is a `/settings#settings-section-<id>` address. `navigate()` in `web/src/lib/router.ts` pushes the address, stores it (path and hash) in the router store that `usePath()` reads, then calls `revealPageAnchor`. That function waits up to 50 animation frames for the element, scrolls to it and outlines it. `initRouter` does the same on load and on `popstate`. `SettingsView` also calls `revealSettingsAnchor` once after mount.

OMRS (`omrs-v4/web/src/settings/SettingsView.tsx`) renders a `role="group"` row of `Button variant="chip"` with `aria-pressed`, and only the selected section.

## Goals / Non-Goals

**Goals:**

- One visible section at a time, selected by chip or by any existing Settings link.
- No change to anchor ids, so no link in the app or in a user's bookmarks breaks.

**Non-Goals:**

- No change to the Skills or Memory page tables of contents, or to the sidebar Settings tree.
- No new section grouping or reordering. The chips follow `SETTINGS_SECTIONS`.
- No change to the sidebar logo image.

## Decisions

1. **The address is the only source of the selected section.** `SettingsView` reads `usePath()`, takes the hash, and selects the section whose id matches. No id, or an id that is not a Settings section, selects the first section. Alternative: local React state synced to the hash. Rejected: two sources of truth, and Back/Forward would need extra wiring that the router store already gives.

2. **Hidden, not unmounted.** All section cards stay mounted. The cards that are not selected get the `hidden` attribute. Today every card is mounted, so typed values in one card survive while the user reads another card. Unmounting would drop unsaved drafts (for example the External API form) on a chip switch. It would also restart each card's data load on every switch. Alternative: OMRS-style conditional render. Rejected for those two reasons.

3. **A chip selects without the reveal.** `navigate()` gets an option to skip `revealPageAnchor`. A chip calls `navigate(\`${ROUTES.settings}#${id}\`, false, { reveal: false })`. It pushes a history entry and updates the router store, so the section changes, but the page does not scroll or outline. Links from elsewhere keep calling `navigate()`without the option and get today's scroll and outline. Because the selected card becomes visible in the same render that the store update causes,`revealPageAnchor` finds a visible element.

4. **A `chip` button variant.** Copy the OMRS classes into `web/src/lib/components/ui/button.tsx`: `border-border bg-transparent text-foreground hover:bg-interactive-hover active:bg-interactive-active aria-pressed:bg-selection`. They use OMMS tokens that already exist. The row is `role="group"` with a translated accessible name (**Sections**) and `flex flex-wrap gap-2`.

5. **Brand classes from OMRS.** In `SidebarBrand.tsx`, the name uses `text-section-title font-semibold` with the default text colour, and the version uses `text-[0.8125rem] text-muted-foreground`. OMMS already defines `--text-section-title: 1.125rem`. It has no `text-meta` token, so the size is written once in the component. The `--brand-label` token stays, because `UpdateButton.tsx` still uses it.

## Risks / Trade-offs

- [Hidden cards still run their effects and timers, as they do today] → No change in load. A later change can unmount heavy cards if needed.
- [Fifteen chips take three or more rows on a phone] → The spec allows wrapping. The search box and sidebar tree stay available. Check at 390 px wide.
- [A future card adds an anchor inside a card, for example `#settings-keys-tokens`] → The selection reads only `settings-section-*` ids today. A nested anchor would select the first section. No such anchor exists now. Note it in the `SETTINGS_SECTIONS` comment.
- [`revealSettingsAnchor` on mount and `revealPageAnchor` from the router can both run on a direct load] → This is today's behaviour. Both scroll to the same visible card.

## Migration Plan

Web UI only. It ships in the next release. Rollback is a revert of the change.
