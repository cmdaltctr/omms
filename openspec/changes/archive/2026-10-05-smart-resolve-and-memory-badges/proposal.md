# Proposal

## Why

Smart resolve currently selects suggestions without saving, so it appears to do the same work as Select all. Memory type and LINKED badges also lack the colours that explain their roles beside coloured keyword tags.

## What Changes

- Smart resolve opens a review dialog for the chosen host. It shows source-to-target mappings, affected session counts, and rows that have no target.
- Confirm saves only the reviewed mappings through the existing settings save path. Cancel changes nothing. A successful save refreshes the list and explains that imports use these maps on their next run.
- Keep Select all with targets and Clear selection as draft-only actions. Preserve unrelated drafts and pending removals when confirming Smart resolve.
- Give memory type labels, including `analysis` and `bug-fix`, stable coloured text and outlines with no coloured fill. Their tooltip says **Memory type**.
- Keep keyword tags and their current stable colours. Their tooltip says **Tags**, while clicking still filters by the keyword.
- Make existing LINKED badges green without changing the prompt-memory relationship.
- Reuse existing label values. Keep memory types separate from keyword tags; rendering must not create tags or rewrite stored memories.
- Translate new dialog text and tooltips into English, Chinese, and Arabic. Update the matching web guides.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `import-directory-maps`: replace Smart resolve's select-only action with review and explicit confirmation, while retaining existing map storage and import resolution.
- `web-visual-design`: define coloured outline memory types, tag role tooltips, green LINKED badges, and stable label presentation.

## Impact

- Settings owners: `DirectoryMapsSection.tsx`, `DirectoryMapHost.tsx`, and the pure helpers in `web/src/lib/directory-maps.ts`.
- Explorer owners: `MemoryCard.tsx`, `KeywordBadge.tsx`, and existing badge and tooltip primitives.
- Existing API: `PATCH /api/settings` with `importPathMaps` and a revision. No new endpoint, dependency, or storage schema is planned.
- Regression tests: directory-map helpers, rendered settings interactions, memory badge appearance, tooltip behaviour, and label stability.
- Documentation: `docs/web-ui-settings.md` and `docs/web-ui.md`.

### Scope boundary

Confirm saves directory maps only. Immediate imports, model calls, changes to the capture taxonomy, and a persistent label catalogue are outside this proposal. A mapping does not recreate a deleted directory or rewrite a host's history files.

The current `import-directory-maps` spec explicitly forbids Smart resolve from saving. This proposal deliberately changes that contract after review and confirmation; merely opening the dialog still saves nothing.
