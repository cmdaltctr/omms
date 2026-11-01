# Proposal

## Why

The Skills page shows "N failed tool calls" on a turn but gives no way to see which call failed or why. A failure with no visible reason can hide a bug in an agent host or in the capture code, and nobody notices. The stored data already holds the tool name, input and error text for every failed call.

## What Changes

- Make the "N failed tool calls" label on a turn row a button. It opens a dialog that lists each failed call: position in the turn, tool name, error text and input.
- Show "No error text recorded" when a failed call has no error text, so silent host failures are visible.
- Add a **Failures** section to the view of one skill. It groups failed calls by tool name and error text, with the number of calls, the number of turns and the last time seen. Selecting a group opens the same dialog with its latest calls.
- Add two read-only routes: failed calls of one turn, and failure groups of one skill. Both load on demand. The turn list and the skill list stay unchanged in size.
- Add a copy button for each failed call in the dialog.
- Add an **Explain failures** button at the top of the Failures section. It sends the grouped failures and the skill's `SKILL.md` to the external API model and shows a plain summary with suggested actions, each labelled as a skill fix, a host or harness bug, an environment problem or unknown. The result is shown and not saved.
- Add a warning for it: a confirmation before the first use, and an "i" button beside the button that opens a popover with the same warning. The button is disabled when skill learning is off.
- Add one POST route for the explanation. It reuses the external API model that drafting uses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-skills`: adds the failed-call dialog on turn rows and the grouped Failures section on the skill view.

## Impact

- Code: `src/services/skill-routes.ts` (two GET routes and one POST route), new modules in `src/services/skill-learning/` for the queries and the explanation, `web/src/lib/skills-api.ts`, `web/src/lib/components/skills/TurnList.tsx`, `SkillDetail.tsx`, a new dialog, a group list component and an explain panel.
- Data: no schema change. Reads `tool_calls` in `skills.db`.
- Privacy: the dialog shows text already stored after `<private>` removal and secret redaction. **Explain failures** sends that stored text, cut to a fixed size, to the external API model, as drafting already does. Nothing new is stored. Logs hold fixed reason codes only.
- Hosts: the web UI is shared by Pi, OpenCode and Claude Code. The agent `skills evidence` mode already returns failed calls first, so no host change is needed.
- Docs: `docs/skill-learning.md` and `docs/web-ui.md`.
