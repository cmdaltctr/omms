## Why

Each user profile card shows "N evidence", but the evidence text is only in a hover tooltip. A tooltip is hard to read for 10 long items, does not work on touch screens, and keyboard users cannot open it.

## What Changes

- The evidence count on preference, pattern, and workflow cards becomes a button.
- The button opens a dialog that lists each evidence item for that card, in a scrolling list.
- The dialog shows the item's description and section, and the hit count with its meaning.
- The `manual-write` marker shows as a readable label, not as raw text.
- The word "evidence" and the new dialog text are translated into English, Chinese, and Arabic.
- The hover tooltip with the joined evidence text is removed. The dialog replaces it.
- No API change. `GET /api/user-profile` already sends the evidence text.

## Capabilities

### New Capabilities

- `web-profile-evidence`: how the web UI shows the evidence behind a user profile item.

### Modified Capabilities

None.

## Impact

- Web UI: `web/src/lib/components/explorer/ProfileView.tsx` (evidence footer), a new dialog component in the same folder, `web/src/lib/i18n/translations.ts`.
- Tests: a new spec under `web/tests/`.
- Docs: the "User profile page" section of `docs/web-ui.md`.
- Depends on the `fix/tag-match-private-prompts` fix. That fix stops OpenCode `<private>` text from reaching new evidence. Merge it first, because the dialog makes evidence easier to read.
