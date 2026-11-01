## Context

`skills.db` already stores each turn's tool calls in `tool_calls` (`turn_id`, `position`, `name`, `input`, `outcome`, `error`). Text is redacted at write time when `skillLearningRedact` is on. The turn list route returns `SkillTurnSummary` with only a count (`failedToolCalls`), by design (no replies, no tool input). The agent `skills evidence` mode already reads failed calls through `draft-turns.ts`. The web UI has `ui/dialog.tsx` and a `PagedList` pattern.

## Goals / Non-Goals

**Goals:**

- See which call failed and why, from the Skills page, in one click.
- Spot repeated failures across turns of one skill.
- Keep the list replies small and private; load detail on demand.

**Non-Goals:**

- Storing tool output bodies. Not stored today and not added here.
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

## Risks / Trade-offs

- **Group count differs from the row labels.** Mitigation: the section heading says which calls count, and the spec states the rule.
- **Large `tool_calls` tables make the group query slow.** Mitigation: the query is scoped to the skill's turn ids (same `turnIdsFor` rule as the turn list) and runs only when the skill view opens. Measure on a store of about 1800 turns and note the time in the PR. Add an index on `tool_calls(turn_id, outcome)` only if the measure needs it, as a separate decision.
- **Hosts that report failures with no error text** show a group "no error text". This is the intended signal, but it may look noisy. The group label explains it.
- **Tool input can hold private content.** Mitigation: it is already redacted at write time when redaction is on. With `skillLearningRedact` off, the dialog shows what the user chose to store. The routes do not log it.

## Open Questions

- Does the existing libSQL build accept window functions? The first task checks this and picks the fallback.
