# Proposal

## Why

The Settings page shows 15 cards on one long page, with a floating contents menu to jump between them. OMRS shows a row of section chips and one section at a time, which is easier to scan. The user wants OMMS Settings and the sidebar title to match OMRS.

## What Changes

- **BREAKING (UI)**: The Settings page no longer shows all cards at once. A row of chip buttons, one per section in the current order, sits below the search box. The page shows only the selected section.
- The floating table of contents on the Settings page is removed. The Skills pages keep theirs.
- The address names the selected section with the existing anchors, for example `/settings#settings-section-log`. `/settings` without an anchor shows **Memory basics**, the first section.
- Every existing way to reach a Settings card still works: the sidebar Settings tree, Settings search results, links from other pages (for example the welcome panel's External API link), direct loads, reloads, and the browser Back and Forward buttons. Each one selects the matching chip.
- Selecting a chip shows its section without scrolling the chips out of view and without the outline flash. A link from elsewhere still scrolls to the card and outlines it, as now.
- The sidebar header name `OMMS` uses the OMRS title style: the section-title size (1.125rem), semibold weight, normal text colour. The version uses a muted colour at 0.8125rem. This replaces the brand green `#678D6C` on the name.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-settings`: replaces the table-of-contents requirement with section chips that show one section at a time, and states that existing links select the matching chip.
- `web-sidebar-header`: changes the name and version style of the sidebar header.

## Impact

- `web/src/lib/components/settings/SettingsView.tsx`: chip row, one section rendered, selection read from the address.
- `web/src/lib/router.ts`: a way to change the anchor without the scroll and outline that `revealPageAnchor` applies.
- `web/src/lib/components/ui/button.tsx`: a `chip` variant, copied from OMRS.
- `web/src/lib/components/explorer/SidebarBrand.tsx`: title and version classes.
- Tests: `web/tests/sidebar-header.spec.tsx` (it asserts `text-brand-label`), the Settings ToC test, and new tests for chip selection.
- Docs: `docs/web-ui.md` (Settings page and sidebar header paragraphs), and the `omms-design` skill if it describes the Settings contents or the brand colour.
- No server, API, config or storage change. OpenCode, Pi and Claude Code hosts are not affected.
