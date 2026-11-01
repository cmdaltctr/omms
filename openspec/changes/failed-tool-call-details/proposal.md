# Proposal

## Why

The Skills page shows "N failed tool calls" on a turn but gives no way to see which call failed or why. A failure with no visible reason can hide a bug in an agent host or in the capture code, and nobody notices. The stored data already holds the tool name, input and error text for every failed call.

## What Changes

- Make the "N failed tool calls" label on a turn row a button. It opens a dialog that lists each failed call: position in the turn, tool name, error text and input.
- Show "No error text recorded" when a failed call has no error text, so silent host failures are visible.
- Add a **Failures** section to the view of one skill. It groups failed calls by tool name and error text, with the number of calls, the number of turns and the last time seen. Selecting a group opens the same dialog with its latest calls.
- Add two read-only routes: failed calls of one turn, and failure groups of one skill. Both load on demand. The turn list and the skill list stay unchanged in size.
- Add a copy button for each failed call in the dialog.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-skills`: adds the failed-call dialog on turn rows and the grouped Failures section on the skill view.

## Impact

- Code: `src/services/skill-routes.ts` (two GET routes), a new module in `src/services/skill-learning/` for the queries, `web/src/lib/skills-api.ts`, `web/src/lib/components/skills/TurnList.tsx`, `SkillDetail.tsx`, and a new dialog and group list component.
- Data: no schema change. Reads `tool_calls` in `skills.db`.
- Privacy: shows text already stored after `<private>` removal and secret redaction. No new data is stored or logged.
- Hosts: the web UI is shared by Pi, OpenCode and Claude Code. The agent `skills evidence` mode already returns failed calls first, so no host change is needed.
- Docs: `docs/skill-learning.md` and `docs/web-ui.md`.
