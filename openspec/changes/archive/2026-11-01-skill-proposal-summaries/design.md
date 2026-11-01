# Design

## Context

See proposal.md, Why. The numbers below come from [TDR-059](../../../docs/tdr/059-skill-proposal-lists-read-large-columns.md) (synthetic store, Apple Silicon Mac, Bun 1.4.4, warm cache, median of 5 runs).

Current readers of proposals:

- `listProposals` (`SELECT *`) feeds `GET /api/skills/proposals`, the proposals in `GET /api/skills/skill`, `skillHistory` and the `proposals` operation of the `skills` tool and the terminal.
- `withCanUndo` calls `canUndoProposal` for each applied proposal. That runs `planUndo`, which reads the full proposal again with `getProposal` and the newest version with `getLatestVersion`. `skill_versions` has no index on `proposal_id`, so each call scans the table.
- `runSkillsTool` returns `JSON.stringify(result)`, so the `proposals` data, with every content and diff, goes into the agent's context.
- The web page fetches the whole list once and sorts, filters and pages it in the browser. `ProposalCard` already fetches `GET /api/skills/proposals/:id` for the evidence turns when it opens.
- The memory chat (merged in PR #207) calls `skillHistory` for up to 6 skills, 5 entries each.

## Goals / Non-Goals

**Goals:**

- Lists never read or send `proposed_content` or `diff`, except the diff (or new-skill content) of the proposals they return, to count lines.
- `canUndo` in a list costs one batched query plus one file hash for each applied proposal.
- The card shows the same diff and content as today once it opens.

**Non-Goals:**

- Server-side sort, filter or paging for the web page. The page keeps the whole summary list (4.1 MB at 5,000 proposals).
- Any schema change, including indexes. See Phase 2.
- GraphQL, a `?fields=` filter, keyset paging, a change to what is stored, and the chat skill facts work.

## Decisions

### D1. Lists name their columns

A new module `src/services/skill-learning/proposal-summaries.ts` holds the summary type, the list query and the line counts. The list query names `id, kind, skill_name, skill_path, summary, evidence_turn_ids, state, applied_by, drafted_by, created_at, updated_at`. It keeps the filters and the order of `listProposals`.

Measured at 5,000 proposals: `SELECT *` takes 56.7 ms and returns 96.3 MB; the named columns take 29.5 ms and return 4.3 MB.

`toProposal` stays for callers that need the full proposal (`show`, apply, undo), through `getProposal`. `listProposals` was removed once no production code called it. A new module keeps `proposal-store.ts` (295 lines) and `skill-operations.ts` (434 lines) under the 500-line ceiling, and keeps `CONFIG` out of the new code.

### D2. The summary shape

Each listed proposal has `id, kind, skillName, skillPath, state, appliedBy, draftedBy, summary, evidenceTurnIds, createdAt, updatedAt, added, removed, hasDiff, canUndo`. It keeps the evidence turn ids, not a count: the card shows "N turns" and the ids cost about 100 bytes for each proposal. The whole summary body measured about 830 bytes for each proposal, against about 19 KB for the current shape (4%).

`baseHash` leaves the list too. No list reader uses it; `show` and the detail route keep it.

### D3. Line counts only for the returned proposals

After the list query (and after `limit` and `offset` when the route gets them), one second query reads `diff`, and `proposed_content` only where `diff IS NULL`, for the ids on the page (`WHERE id IN (SELECT value FROM json_each(?))`). `added` and `removed` follow `countDiffLines`. A proposal with no diff counts its content lines as added, as `diffStat` does in the web today.

Without `limit` and `offset` the page is the whole list, so the route still reads every diff. Measured cost at 5,000: small columns and diff take 36.6 ms against 29.5 ms without diff. The full prototype of the summary route (case 5c) took 84.5 ms. That is acceptable, so stored line counts wait for phase 2. Counting the lines inside SQLite was tried and was about 20 ms slower at 5,000 (see TDR-059), so the lines are counted in JavaScript.

### D4. canUndo from one batched lookup

`apply.ts` gets a check that takes the data it needs: the proposal state, the newest version's `path` and `written_hash`, the folders and the read-only flag. `planUndo` calls it after its own reads, so undo and the list share one rule. `withCanUndo` reads the newest version of every applied id in one query that names `proposal_id, path, written_hash` (no `previous_content`), then runs the check for each.

Measured at 5,000: the current route takes 944 ms. An index on `skill_versions(proposal_id)` brings it to 275 ms. The batched prototype brings it to 84.5 ms with no index. So phase 1 batches and adds no index.

### D5. skillHistory reads small columns

`skillHistory` reads the summary columns for the skill, builds the entries, sorts them and takes the page, as today. Then it loads the diffs of the proposals on that page only, to count lines, and runs the batched `canUndo` for the applied entries on the page. A history entry for a new skill keeps `added` 0 and `removed` 0, as today.

Measured at 5,000 for a skill with 1,288 proposals: 25.3 ms and 11.7 KB today. The gain here is small. The change keeps the large columns out of every list path, so one rule holds.

### D6. The web loads the detail when a card opens

`skillsApi.proposals()` returns summaries. The compact card uses `added`, `removed`, `hasDiff`, `kind` and `evidenceTurnIds.length` for the line chip and for `hasMoreDetail`. **Show more** fetches `GET /api/skills/proposals/:id` once, which already returns the proposal and its evidence. The card keeps that detail until it unmounts. While the fetch runs, the card shows a loading line. A failed fetch shows a short error and keeps the buttons.

**Apply**, **Reject** and **Undo** send only the id, and the server reads the stored content, so they do not need the detail. Their replies carry the full proposal. The card turns that reply into a summary with the existing `diffStat` and keeps the detail it holds. A test checks that `diffStat` and the server's counts agree for the same diff.

### D7. The skills tool and the terminal return summaries

The `proposals` operation returns the summary shape in `data.proposals`. Its text lines stay the same. Sizes decided it: the full shape is 2.0 MB at 100 proposals, and `runSkillsTool` sends it all into the agent's context. The summary shape is 83 KB at 100. `show` keeps the full proposal. `om-memory-system skills proposals --json` prints the same operation result, so it changes in the same way. `skills list` lists skills and does not change.

### D8. Host parity

The Skills page is web only. The `skills` tool and the terminal command run the same operation in `src/core/skill-operations.ts` for Pi, OpenCode and Claude Code, so all three hosts change together, with no adapter change.

### D9. Guardrail tests

- A route test fails when any proposal in `GET /api/skills/proposals` or in `GET /api/skills/skill` has `content` or `diff`.
- A size-budget test seeds 500 proposals with 20 KB of content, 300-character summaries and 30 evidence ids, and asserts that the `GET /api/skills/proposals` body stays under 600,000 bytes. The measured rate gives about 415,000 bytes (500 times about 830). The full shape would be over 10 MB.
- A web regression test opens a card with **Show more** and checks the full diff and evidence.
- Each new test must fail on the current code before the change makes it pass.

### D10. File sizes

Current line counts: `SkillsView.tsx` 313, `ProposalCard.tsx` 279, `SkillDetail.tsx` 211, `skill-routes.ts` 338, `history.ts` 138, `apply.ts` 380, `proposal-store.ts` 295, `skill-operations.ts` 434. The detail loading adds about 40 lines to `ProposalCard.tsx`. If the card would pass 500, the detail loading moves into a `useProposalDetail` hook. The summary code goes into the new module (D1), so `skill-operations.ts` does not grow.

## Phase 2: a later step, not in this change

The numbers do not justify phase 2 now. The real store has 5 proposals. At 5,000 synthetic proposals, the phase 1 prototype of the list takes 84.5 ms and today's history takes 25.3 ms.

**Trigger.** Start phase 2 as its own OpenSpec change when one of these happens:

1. A real store passes 5,000 proposals. That is the largest size measured; past it, the numbers are a guess.
2. After phase 1, `scripts/measure-proposals-list.ts` shows a median above 200 ms for the list route or for `skillHistory`.

**Scope when triggered.**

- Add `lines_added` and `lines_removed` to `skill_proposals`, written when a proposal is saved.
- Add an append-only `skill_proposal_events` table (`proposal_id`, `kind` created, applied, rejected, undone or stale, `at`, `applied_by`, `version_id`, `lines_added`, `lines_removed`), written in the same transaction as each state change, with an index on the skill key and `at DESC`.
- `skillHistory` becomes one indexed query with `LIMIT` and `OFFSET`.
- Bump `SKILL_SCHEMA_VERSION` to 2. `init` backfills the counts and events from existing rows in one transaction. A file with a newer schema stays read-only, as today.
- Write an ADR for the schema change. Use ADR-039 (see the coordination note).

**Also measured, for phase 2 to weigh.** Large columns before the small ones slow every scan: reading `id, state, summary, created_at` takes 18.0 ms as the table is, and 7.36 ms with the large columns last. `LIMIT 5` still takes 17.9 ms, because no index covers `created_at`. The newest-version lookup scans `skill_versions` for each call. Phase 2 can add indexes on `skill_versions(proposal_id)` and on the list order, or rebuild the table with the large columns last.

**Rollback.** The events table and columns are additive. Going back to an older OMMS opens the version 2 file read-only for skill writes, as the schema guard does today. No data is lost. A new OMMS again writes it normally.

Offset paging stays in both phases. The measurements show no need for keyset paging.

## Risks / Trade-offs

- [API callers that read `content` or `diff` from a list break] → The proposal marks it **BREAKING**. The detail route and `show` keep the full shape. The docs show both shapes.
- [The card shows a short wait on **Show more**] → It is one local request for one row by its primary key. The card already makes this request for the evidence turns today. The card shows a loading line.
- [Two places count lines: the server for lists and `diffStat` for action replies] → A test checks that both give the same counts for the same diff.
- [The tool's `proposals` result still grows by about 830 bytes for each proposal] → Acceptable at today's sizes. A `limit` for that mode is a possible later change, not part of this one.
- [The measurements use synthetic data on one machine] → TDR-059 states the limits. Phase 1 checks the gain by running the script again.

## Migration Plan

No data migration. Ship server and web together in one release; the web bundle ships inside the package, so they cannot drift. To roll back, install the previous version. Nothing stored changes.

## Coordination note

ADR-038 is taken on `main` by the chat skill facts work (`docs/adr/038-chat-reads-skill-facts-from-skills-db.md`, merged in PR #207). This change needs no ADR, because phase 2 is out of scope. If phase 2 starts, its ADR is ADR-039, and its index row goes after the 038 row in `docs/adr/ADR_README.md`. The chat work also calls `skillHistory`; D5 keeps that function's signature and result shape, so chat code does not change.
