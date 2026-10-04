# Design

## Context

See proposal.md for motivation. The worktree already contains the archived directory-map controls at commit `00712bf`. The user chose to keep this follow-up in the same worktree.

Observed owners and constraints:

- `ImportStatusBadge.tsx` renders every state as a span. `HostImportBadges.tsx` knows the host but passes only the badge result. `AutoImportSection.tsx` repeats the same pill beside each host name.
- Automatic import already displays operational state, actions, last-run summaries, and unresolved counts separately. Its Directory maps links currently target the general Settings wrapper.
- `DirectoryMapsSection.tsx` owns decisions globally by source path. `DirectoryMapHost.tsx` uses native disclosures that are closed by default. Navigation must reveal a disclosure without replacing these owners.
- The application has one page H1 in `App.tsx`. Settings cards generally use H2 and inner groups H3. `settings.css` forces H2 to 14px while normal Settings text is 13.5px. `ProfileView.tsx` starts at H3 and uses H4 for its main groups.
- `app.css` owns shared typography tokens. The page-title token is 17px and is also used by the shared `DialogTitle`. Stored memory Markdown has its own rendering and style owner.
- Existing section anchors are used by the sidebar. Keep both `settings-section-directory-maps` and `directory-maps`.

## Goals / Non-Goals

**Goals:** Use host identity already available in the UI to reach the right list. Make section structure readable and preserve drafts while changing presentation.

**Non-Goals:** Change badge derivation, import scheduling, suggestion rules, backend endpoints, route paths, sidebar widths, stored memory text, or Markdown heading rendering. Add no dependencies or invented card titles.

## Decisions

### 1. Host-aware anchors with explicit reveal and focus

Give each Directory maps host summary a stable host-specific anchor, such as `directory-maps-pi`, `directory-maps-opencode`, and `directory-maps-claude-code`. Retain the existing general anchors.

Use real same-page links for Partly imported badges. Pass the host from `HostImportBadges` into the badge/link owner; do not infer it from translated text. Use the same reveal operation for Automatic import's existing Directory maps links. A small shared helper can find the summary by host, open its parent disclosure, and focus the summary without an extra scroll. The link's normal anchor navigation then places the summary in view. Keep visible focus and enough scroll clearance for the mobile header.

Handle reveal on every user activation, including when the fragment is already current. Other hosts keep their open states. Do not expand target editors, reload data solely because of navigation, reset drafts, or run save/import operations. If the latest list is empty, reveal the host's existing empty state.

Prefer this bounded DOM operation over adding shared navigation state, an event bus, or a routing layer. All Settings cards already mount together. Explicit reveal avoids depending on browser-specific automatic disclosure opening. Native links retain pointer and keyboard semantics; do not turn informational statuses into pretend links.

New accessible text uses the existing English/Chinese/Arabic settings pairs. Include the host and destination in the link name while keeping the visible badge text and count unchanged. Any animated scroll must respect reduced motion; a normal anchor jump needs no new animation.

### 2. One overall import-status summary

Keep the overall pills in Import and backfill. Remove their repeated rendering from the host headings in Automatic import, along with imports or variables made unused by that removal.

Keep the latter section's operational state, model choice, pending/unresolved counts, errors, progress, last-run summary, and controls. Its unresolved link uses the shared host target. Removing the entire operational status block would hide useful run information and would conflict with `web-settings`.

### 3. Shared application typography roles

Use relative sizes at the current 16px root:

| Role             | Size             | Intended owner                         |
| ---------------- | ---------------- | -------------------------------------- |
| Page title       | 1.5rem / 24px    | Application H1                         |
| Section title    | 1.125rem / 18px  | Main card/section H2 and dialog titles |
| Subsection title | 0.9375rem / 15px | Nested group/card H3                   |
| Normal UI text   | 0.875rem / 14px  | Normal labels and prose                |

Keep helper/caption and technical code roles at their existing smaller sizes. Use the current semantic colours, system sans-serif UI font, and monospace technical font. Headings use semibold weight, appropriate line height, and wrapping rather than truncation.

Define roles in `app.css` and apply them in current owners. Remove or align the Settings H2 override so it cannot flatten the new scale. Avoid blanket global heading selectors: they could restyle stored Markdown. Decouple `DialogTitle` from the page-title role and use the section-title role so the page change has no unintended 24px dialog title.

Use shared roles rather than another heading component, because the current markup already supplies most semantic elements. Inspect calculated sizes in the browser; class names alone cannot prove the result.

### 4. Correct the application outline without changing content

Keep `App.tsx` as the page-H1 owner. Main Settings cards remain H2, with host groups and Saved maps at the appropriate nested level. Disclosure summaries remain interactive summary elements; their meaningful host titles can contain an appropriately scoped heading without putting buttons or checkboxes inside the summary click target.

On Profile, use H2 for the identity and the top-level Preferences, Patterns, and Workflows sections. Use H3 for a genuinely titled card nested within a section. Category badges and ordinary item descriptions keep their label/prose roles. On Project memories, align the application section titles, including the add-memory area, with the shared scale. Keep identifiers, card metadata, and stored Markdown rendering intact; do not manufacture a title from an ID.

Dialogs retain their accessible title primitive and existing focus handling. Heading changes must not remount sections or dialogs, change sidebar anchors, or reinterpret stored content.

### 5. Tests and verification scope

Extend the existing Bun helper/render tests and add focused navigation/heading tests under `web/tests/`. Prove new assertions fail before the relevant implementation, or fail under an explicit mutation. Keep badge derivation tests intact.

The user waived this change's synthetic browser checks (task 3.2) and visual matrix (task 3.3) during implementation. No new browser fixtures or browser evidence are required for the execution gate. This is a fresh waiver for this change, separate from the archived change's waiver. Keep the existing synthetic fixture's no-proxy boundary.

Record actual link activation, scroll/focus, draft retention, computed typography, keyboard input, theme/language layout, mobile widths, and native 200% zoom as NOT RUN. Behaviour requirements remain unchanged. Focused helper/render tests, the approved full `ci:local` gate, security scanning, and OpenSpec verification remain required. Class names and static tests cannot prove browser layout or interaction outcomes.

## Risks / Trade-offs

- Larger headings need more space. Mitigation: wrap titles. Browser layout and native zoom remain unverified under the user's waiver.
- A changed page-title token could affect dialogs. Mitigation: use the section role explicitly in the shared dialog title and verify callers.
- A link can land on a hidden list or an unchanged fragment. Mitigation: reveal and focus on each activation while keeping the general anchors.
- Badges can show counts older than the latest directory list. Mitigation: reveal the requested host's empty state without inventing rows or changing count derivation.
- Profile and Markdown titles have different owners. Mitigation: scope application styles and test stored-content rendering remains unchanged.

## Migration Plan

No data migration. Implement over `00712bf` in the requested worktree. Update the web UI guides and the OMMS typography adaptation in the design reference, preserving the attributed OpenChamber source values. Run focused checks, the approved full CI gate, security scanning, and OpenSpec verification. Revert frontend changes to roll back; saved maps and other settings remain compatible.
