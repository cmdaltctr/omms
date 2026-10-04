# Design

## Context

See proposal.md for motivation. `DirectoryMapsSection.tsx` currently expands every host and target row. Suggestions are supplied by `directoryMapsView`; `applySuggestions` accepts suggested rows and returns filled/not-filled counts. Targets are already displayed before Smart resolve is clicked, so a changed checkbox can be the only visible difference.

The component holds decisions by source path. Saved maps apply to every host and use the existing revision-checked settings PATCH. Sessions with no recorded path use the empty-string sentinel. The reported click has not been reproduced in the running app.

## Goals / Non-Goals

**Goals:** Keep actions discoverable with large lists, preserve drafts during collapse, and provide testable feedback for actions that select nothing.

**Non-Goals:** Change suggestion heuristics, assign unknown chats automatically, add import calls on save, or modify the release-approve fix.

## Decisions

### Native disclosure controls

Use native details/summary controls for host lists and individual target editors, styled with existing theme tokens. This avoids adding an accordion dependency. Keep controls outside summary click targets to prevent accidental toggles. A compact row includes its source, session count, selection checkbox, and target summary; expansion reveals editing and explanation. Save maps stays outside all disclosures.

Host sections start collapsed. Each summary reports counts derived from current rows and decisions. Draft state stays in the section owner so disclosure toggles cannot discard it. Existing section anchors remain intact.

### Bulk selection uses existing target values

Add a pure selection helper beside `applySuggestions`. Edited target text takes precedence over suggestions, including an explicitly emptied target. A non-empty target is eligible for selection; it is not a guarantee that the directory still exists. Preserve existing validation and import-time directory checks. Server-provided suggestions already require an existing directory.

Keep decisions keyed by source path because a saved map is global. Selecting or clearing a shared source updates its appearance under every host. Explain this near the bulk controls. Clear selection preserves target text. Rejecting empty targets prevents silently assigning chats to a guessed project.

### Visible feedback for Smart resolve

Report newly selected, already selected, and no-suggestion rows through an accessible status region beside the toolbar. Distinguish an already-completed selection from missing suggestions. Continue requiring review and Save maps. Keep accepted choices unchanged.

### Verification and localisation

Use the existing settings translation helper for English, Chinese, and Arabic. Keep paths left-to-right in Arabic. Focused helper tests cover empty targets, repeated clicks, accepted edits, and shared sources. Interactive browser checks verify disclosure toggles, checkbox state, feedback placement, draft retention, and reachable saving with long lists. Match the omms-design visual verification matrix.

On 4 October 2026, the user waived the remaining task 3.2 browser checks and approved archive and commit. Keep the completed evidence and unverified checks in `verification.md`. This changes the verification gate only; the specified keyboard-accessible behaviour remains required.

## Risks / Trade-offs

- Bulk selection can accept a wrong suggested project: require explicit review and Save maps; preserve per-row editing.
- A collapsed list can hide edits: display selected counts and retain state.
- Shared source paths can surprise users across hosts: retain global-map semantics and explain them beside the actions.
- User-entered targets can point to missing folders: keep existing validation and unresolved reporting; do not claim bulk selection confirms disk existence.

## Migration Plan

No data migration or dependency change. Deploy as a normal web UI change. Reverting the controls leaves saved maps compatible. Keep the release fix on its existing branch.
