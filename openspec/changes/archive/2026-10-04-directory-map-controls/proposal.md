# Proposal

## Why

Long lists in Directory maps require excessive scrolling. Smart resolve can leave the user unsure whether it selected anything, especially when no suggested targets exist.

## What Changes

- Collapse each host's unresolved directory list by default, with directory, session, and selected counts in its summary.
- Show compact directory rows with expandable target controls.
- Add per-host Select all with targets and Clear selection actions. Empty targets and sessions without a recorded directory are excluded.
- Keep Smart resolve feedback beside its button, including a clear explanation when it selects nothing.
- Preserve explicit Save maps and the existing project assignment rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `import-directory-maps`: compact expandable lists, bulk selection, and visible feedback for suggestion actions.

## Impact

Changes affect `DirectoryMapsSection.tsx`, `web/src/lib/directory-maps.ts`, settings translations, focused tests, and `docs/web-ui-settings.md`. No new dependencies, model calls, import rules, or host adapter changes are required. Pi, OpenCode, and Claude Code receive the same controls.

The reported ineffective click has not been reproduced against the user's running app. Inspection confirms that Smart resolve already selects suggested rows and does not save. This proposal improves visibility and bulk review without claiming a runtime bug has been diagnosed.
