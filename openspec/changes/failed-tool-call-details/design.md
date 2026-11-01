## Context

`skills.db` already stores each turn's tool calls in `tool_calls` (`turn_id`, `position`, `name`, `input`, `outcome`, `error`). Text is redacted at write time when `skillLearningRedact` is on. The turn list route returns `SkillTurnSummary` with only a count (`failedToolCalls`), by design (no replies, no tool input). The agent `skills evidence` mode already reads failed calls through `draft-turns.ts`. The web UI has `ui/dialog.tsx` and a `PagedList` pattern.

## Goals / Non-Goals

**Goals:**

- See which call failed and why, from the Skills page, in one click.
- Spot repeated failures across turns of one skill.
- Keep the list replies small and private; load detail on demand.

**Non-Goals:**

- Storing tool output bodies. Not stored today and not added here.
- Saving explanations, or turning one into a proposal. A later change can add that.
- A cross-skill failures page. The group view is per skill. A later change can add it.
- Changing ranking, attention scores or the "Suggested" rule.
- Any change to capture or to the `tool_calls` schema.

## Decisions

1. **Two GET routes, on demand.** `GET /api/skills/turns/:id/failures` returns `{ failures: [{ position, name, input, inputCut, error }] }` for one turn, ordered by `position`. `GET /api/skills/failures?path=&name=` returns `{ groups: [...] }` for one skill, using the same skill query parameters as `/api/skills/skill`. Alternative: add failures to the turn list reply. Rejected: it grows every list reply and sends tool input that most users never open (compare TDR-059).
2. **New module `src/services/skill-learning/failures.ts`** holds both queries. `skill-routes.ts` is 345 lines and keeps only the route wiring.
3. **Input cap of 20000 characters on the server**, flag `inputCut`. The UI clamps to 400 characters with a toggle. Alternative: send full input. Rejected: a file-write call can hold megabytes.
4. **Group key = tool name + first line of error text, cut to 200 characters.** Null error text groups by tool name alone. Grouping is done in SQL (`GROUP BY name, key`), with the key built from `substr(error, 1, instr(error || char(10), char(10)) - 1)` then `substr(..., 1, 200)`. The five latest calls per group come from a second query over the group keys, or a window function (`ROW_NUMBER() OVER (PARTITION BY ...)`), whichever libSQL handles in the existing store. Alternative: group in JavaScript. Rejected for large stores, but acceptable as a fallback if the window function is not supported.
5. **Group counts follow the ranking rule.** Only calls after the skill's use position count (see `ranking.ts`). The turn dialog shows all failed calls of the turn, because the user opened a turn, not a skill. Result: the group total can be lower than the sum of turn labels. The Failures section says "failed calls that count against this skill".
6. **One dialog component** (`FailedCallsDialog`) serves both entry points. It takes a title and a list of calls. Group calls add time and project. The Copy button writes plain text through `navigator.clipboard`, with the selection fallback the app already uses for other copy buttons if one exists.
7. **Missing `skills.db`** gives empty replies and the file stays missing, as in `turn-summaries.ts` (`store.existingDb()`).
8. **No setting gates the routes.** They read data that exists only when recording was on. The existing web server rules apply: loopback by default and token for any other host.

9. **Explain through the drafting model path.** A new POST route `/api/skills/explain-failures` (`path`, `name`) calls a new `failure-explain.ts`. It builds the request from the group query (top 10 groups, 500-character input excerpt, `SKILL.md`) and calls `SkillModel.callTool` with one tool schema: `{ summary, causes: [{ kind: skill | harness | environment | unknown, explanation, actions[] }] }`. It uses the same external API setup and failure codes as drafting, including `not-configured`. Alternative: reuse `draftImprovement`. Rejected: it saves a proposal, and this reply is not kept.
10. **No backoff, no auto run.** The user starts each explanation, so the draft backoff does not apply.
11. **Warning in two places from one text.** One strings block feeds the first-use confirmation dialog and an `InfoPopover` ("i") beside the button. The confirmation uses the existing dialog and `Callout`. A red tone shows when `redact` is off (`/api/skills/stats` already reports it). The confirmation is remembered in `localStorage` (per-viewer convenience, wrapped in try/catch). Without storage it asks every time.
12. **Disabled state from facts the page already has.** Skill learning off comes from the overview `recording` flag. No group means the groups reply is empty.

## Risks / Trade-offs

- **Group count differs from the row labels.** Mitigation: the section heading says which calls count, and the spec states the rule.
- **Large `tool_calls` tables make the group query slow.** Mitigation: the query is scoped to the skill's turn ids (same `turnIdsFor` rule as the turn list) and runs only when the skill view opens. Measure on a store of about 1800 turns and note the time in the PR. Add an index on `tool_calls(turn_id, outcome)` only if the measure needs it, as a separate decision.
- **Hosts that report failures with no error text** show a group "no error text". This is the intended signal, but it may look noisy. The group label explains it.
- **Explain sends stored text to an external model.** Same exposure as drafting (ADR-033 precedent), but it is a new send path. Mitigation: the request holds grouped data and 500-character excerpts, not whole turns; the first-use confirmation and the "i" popover state it; the button is off when recording is off; the log holds codes only.
- **The model cannot see host code.** Its harness-bug label is a guess from error text. The panel says so, and the labels are leads.
- **Tool input can hold private content.** Mitigation: it is already redacted at write time when redaction is on. With `skillLearningRedact` off, the dialog shows what the user chose to store. The routes do not log it.

## Open Questions

- Does the existing libSQL build accept window functions? The first task checks this and picks the fallback.
