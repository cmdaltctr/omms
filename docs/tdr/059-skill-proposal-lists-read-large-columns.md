# TDR-059: Skill proposal lists read the large columns

- **ID:** TDR-059
- **Date:** 2026-10-31
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** sqlite, skills-db, performance, skill-learning

## Context

Issue #192 says that the Skills page loads every proposal with its full content. `listProposals` runs `SELECT *` on `skill_proposals`, so each list row holds `proposed_content` and `diff`. `GET /api/skills/proposals` sends every proposal, and the page pages the list in the browser. `skillHistory` reads every proposal of one skill to build one page of 20 entries. The real store has 5 proposals (67 KB in total), so nobody sees a problem today. We measured when it becomes one.

## Method

- `scripts/measure-proposals-list.ts` starts itself again with `HOME` set to a new temporary folder. It never opens `~/.omms`. The parent removes the folder at the end.
- It builds `skills.db` through the real `SkillStore` and proposal store functions. It seeds N = 100, 1,000 and 5,000 proposals with a fixed random seed.
- Sizes: `proposed_content` 4 to 24 KB, `diff` 1 to 6 KB, summary about 300 characters, 5 to 30 evidence turn ids. 30 skills, weighted 1/(i+1), so the busiest skill holds about a quarter of the proposals (1,288 at N = 5,000).
- States: 30% pending, 35% applied, 25% rejected, 10% undone. Each applied and undone proposal has a `skill_versions` row. Each version holds the current file hash, so `canUndo` does its full check.
- Each case runs once to warm up, then 5 times. The table shows the median. The script also prints the maximum. Bytes are the UTF-8 length of `JSON.stringify` of the result.
- Machine: Apple Silicon Mac (darwin arm64), Bun 1.4.4, SQLite page size 4,096 bytes.

Run it again with `bun scripts/measure-proposals-list.ts`. It takes about 20 seconds.

## Measurements

Median milliseconds, then the bytes the call returns.

| Case                                                        | N = 100        | N = 1,000      | N = 5,000      |
| ----------------------------------------------------------- | -------------- | -------------- | -------------- |
| 1 `listProposals(store, {})` (`SELECT *`)                   | 1.13 / 2.0 MB  | 11.0 / 19.2 MB | 56.7 / 96.3 MB |
| 2 the same query, small columns only                        | 0.53 / 86 KB   | 4.95 / 866 KB  | 29.5 / 4.3 MB  |
| 2b small columns and `diff`                                 | 0.63 / 462 KB  | 6.27 / 4.5 MB  | 36.6 / 22.7 MB |
| 3 small columns, `LIMIT 5`                                  | 0.34 / 4.2 KB  | 3.19 / 4.4 KB  | 17.9 / 4.6 KB  |
| 4 `skillHistory`, busiest skill, page of 20                 | 0.76 / 11.6 KB | 4.99 / 11.9 KB | 25.3 / 11.7 KB |
| 4b skill detail proposals (`listProposals` + `withCanUndo`) | 0.53 / 395 KB  | 15.3 / 5.0 MB  | 309 / 24.9 MB  |
| 5 `GET /api/skills/proposals` route, current body           | 4.03 / 2.0 MB  | 60.3 / 19.3 MB | 944 / 96.4 MB  |
| 5 summary-only body (bytes only)                            | 83 KB          | 831 KB         | 4.1 MB         |
| 5c summary list prototype (batched `canUndo`)               | 1.64 / 83 KB   | 18.0 / 831 KB  | 84.5 / 4.1 MB  |
| 5d route, with an index on `skill_versions(proposal_id)`    | 3.87 / 2.0 MB  | 57.2 / 19.3 MB | 275 / 96.4 MB  |
| 4c skill detail proposals, with that index                  | 0.48 / 395 KB  | 14.5 / 5.0 MB  | 71.4 / 24.9 MB |

Case 6 reads `id, state, summary, created_at` from copies of the table with a different column order:

| Table layout                                                | N = 100 | N = 1,000 | N = 5,000 |
| ----------------------------------------------------------- | ------- | --------- | --------- |
| `skill_proposals` as it is (large columns before `summary`) | 0.39    | 3.81      | 18.0      |
| Copy, large columns first                                   | 0.37    | 3.43      | 17.2      |
| Copy, small columns first, large columns last               | 0.11    | 1.36      | 7.36      |
| Copy with no large columns                                  | 0.10    | 0.81      | 4.31      |

Memory: a separate process that runs case 1 once at N = 5,000 grew from 25.9 MB to 248.0 MB RSS. The peak was 248.0 MB.

Query plans: `getLatestVersion` (`WHERE proposal_id = ?`) does `SCAN skill_versions`. The list query and the `skill_path` filter do `SCAN skill_proposals; USE TEMP B-TREE FOR ORDER BY`.

## Finding

1. **The route time is mostly `canUndo`, not the list query.** At N = 5,000 the list query takes 57 ms and the route takes 944 ms. `withCanUndo` runs `planUndo` for each applied proposal. Each run reads the full proposal again (`SELECT *`) and scans all of `skill_versions`, because no index covers `proposal_id`. An index cuts the route to 275 ms. One batched version lookup with small columns (case 5c) cuts the work to 84.5 ms, with no schema change.
2. **The body size is the content.** The summary-only body is 4% of the current body: about 830 bytes for each proposal against about 19 KB.
3. **Large columns slow reads of the small columns.** A row longer than about 4 KB keeps the rest in overflow pages. `summary`, `state` and `created_at` sit after `proposed_content` and `diff`, so SQLite reads the overflow chain to reach them. Small columns first is 2.4 times faster at N = 5,000. Naming the columns halves the time and cuts the bytes 22 times, but it does not remove this cost.
4. **`LIMIT` alone does not help.** No index covers `created_at`, so SQLite sorts every row first. `LIMIT 5` still takes 17.9 ms at N = 5,000.
5. **`skillHistory` stays small.** It takes 25.3 ms at N = 5,000 for a skill with 1,288 proposals. It returns 11.7 KB.

## Decision

- Phase 1 (OpenSpec change `skill-proposal-summaries`): lists name their columns, never read `proposed_content` or `diff` except to count lines on the returned page, send a summary shape, and check `canUndo` with one batched lookup. The web page loads the full proposal when a card opens.
- Phase 2 (new columns, an event table, indexed history) is not justified by these numbers. The change records it as a later step with a trigger.

## Limits of the method

- The data is synthetic. Real proposals can have other sizes, other states and other skill spreads.
- One machine, one run of 5 measurements per case. No other load ran.
- The cache was warm. The SQLite page cache is small, so the reads came from the operating system file cache, not from disk. A cold read is slower.
- Route times exclude `JSON.stringify` of the body and the transfer to the browser. Both grow with the body size, so the real gap is larger.
- Case 5c is a throwaway prototype in the script. It hashes the file directly instead of calling `planUndo`, so the real code will be slightly slower.

## Consequences

**Positive**

- The numbers give a trigger for phase 2 instead of a guess.
- The script can run again after the change to check the gain.

**Negative**

- The script reads internal modules. A change to `SkillStore` or the route may break it. It is not part of `ci:local`.

## Revisit Triggers

- A real store passes 5,000 proposals, the largest N measured.
- After phase 1, the list route or `skillHistory` median passes 200 ms in this script.

## References

- Issue #192
- `scripts/measure-proposals-list.ts`
- `openspec/changes/skill-proposal-summaries/`
- `src/services/skill-learning/proposal-store.ts` (`listProposals`), `history.ts` (`skillHistory`, `withCanUndo`), `apply.ts` (`planUndo`)
