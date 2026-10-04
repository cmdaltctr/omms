# Proposal

## Why

Unresolved import badges identify a problem without taking the user to its directory list. Duplicate badges under Automatic import add noise, while small headings make page and card structure hard to see.

## What Changes

- Make each Partly imported badge in Import and backfill link to that host's unresolved directories, open its Directory maps disclosure, and move focus to its summary.
- Keep the badge's wording and count. Other status badges remain informational.
- Remove repeated overall-status pills beside host headings in Automatic import. Keep run state, progress, counts, model controls, errors, and actions.
- Make the existing unresolved-directory links in Automatic import reach the matching host list too.
- Give application headings a consistent semantic hierarchy and visible sizes: page H1 24px, section/card H2 18px, subsection H3 15px, and normal UI body text 14px at the standard root size.
- Correct skipped heading levels on the Profile page. Apply the hierarchy across Project memories, User profile, and Settings without inventing headings for metadata-only rows or changing stored memory content.
- Preserve the current themes, translations, routes, existing section anchors, and draft state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-settings`: actionable unresolved import badges and removal of duplicate overall-status pills from Automatic import.
- `import-directory-maps`: host-specific navigation reveals and focuses the matching unresolved directory disclosure without resetting drafts.
- `web-visual-design`: a shared semantic and visual hierarchy for application headings and body text.

## Impact

Frontend-only changes to status badge components, Automatic import, Directory maps, application typography, and page/card heading owners. Relevant owners include `App.tsx`, `app.css`, `ProfileView.tsx`, `settings.css`, and the shared dialog title whose current style reuses the page-title token. Tests and the matching web UI guides will change with the implementation.

No backend API, import-resolution, storage, dependency, or host-adapter changes are required. Pi, OpenCode, and Claude Code receive the same navigation. This proposal stays in the existing `omms-feat-directory-map-controls` worktree at the user's request and builds on commit `00712bf`. The earlier archived change remains intact.

## Verification scope

The user waived browser checks in tasks 3.2 and 3.3 during implementation and approved `bun run ci:local`. This waiver covers synthetic browser interactions and the visual matrix, including mobile layouts and native zoom. Behaviour requirements remain unchanged. Report these browser checks as NOT RUN; focused tests, security scanning, and OpenSpec verification remain required.
