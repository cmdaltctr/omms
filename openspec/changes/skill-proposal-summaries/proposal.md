# Proposal

## Why

Every proposal list reads and sends the full `SKILL.md` content and diff of every proposal (issue #192). [TDR-059](../../../docs/tdr/059-skill-proposal-lists-read-large-columns.md) measured synthetic stores: at 5,000 proposals `GET /api/skills/proposals` takes 944 ms and sends 96.4 MB, and at 100 proposals it already sends 2.0 MB. The same full list goes into the agent's context through the `skills` tool. The real store has 5 proposals today, so we fix the shape now, while the change is small and no one waits for it.

## What Changes

- List reads name their columns. They never use `SELECT *` and never read `proposed_content` or `diff`, except to count the lines of the proposals they return.
- `GET /api/skills/proposals` and the proposals in `GET /api/skills/skill` return a summary for each proposal: id, kind, skill name and path, state, who applied it, who drafted it, summary, evidence turn ids, times, added and removed line counts, `hasDiff` and `canUndo`. **BREAKING** for API callers: `content` and `diff` are gone from these lists.
- `GET /api/skills/proposals/:id` stays the detail route with `content`, `diff` and the evidence turns.
- `canUndo` in a list comes from one batched lookup of the newest saved versions. It no longer reads each proposal and scans `skill_versions` once per applied proposal.
- The Skills page loads the detail of a proposal when the user selects **Show more**, or before **Apply** or **Reject** needs it. The compact card shows the server's line counts.
- `skillHistory` reads small columns only. It reads a diff only for the entries on the returned page, to count their lines.
- The `skills` tool and `om-memory-system skills proposals` return summaries in the `proposals` data. Their text lines do not change. **BREAKING** for `--json` and tool callers that read `content` or `diff` from `proposals`: use `show`. `skills list` lists skills, not proposals, and does not change.
- A later phase 2 (stored line counts, an append-only event table, indexed history) is documented in design.md with a trigger. It is not part of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skill-learning-proposals`: proposal lists from the routes, the `skills` tool and the terminal return summaries; the detail comes from `show` or the detail route.
- `web-skills`: proposal cards load the full proposal when they open or before an action needs it.

## Impact

- Server: `src/services/skill-learning/proposal-store.ts` (a summary list query), `src/services/skill-learning/history.ts` (`skillHistory`, `withCanUndo`), `src/services/skill-learning/apply.ts` (an undo check that takes data it is given), `src/services/skill-routes.ts`, `src/core/skill-operations.ts`.
- Web: `web/src/lib/skills-api.ts`, `web/src/lib/skills-model.ts`, `web/src/lib/components/skills/ProposalCard.tsx`, `SkillsView.tsx`, `SkillDetail.tsx`, `ProposalList.tsx`, `web/src/lib/i18n/skills.ts`.
- Hosts: Pi, OpenCode and Claude Code share the `skills` tool through `src/core/`, so all three change together.
- No schema change. No new dependency.
- Docs: `docs/skill-learning.md` (API table), `docs/web-ui.md` (proposal cards), `docs/cli.md` (`proposals` data).
- The memory chat calls `skillHistory` for up to 6 skills. It gets the faster reads with no change to chat code.
