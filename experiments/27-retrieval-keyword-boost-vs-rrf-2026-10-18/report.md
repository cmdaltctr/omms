# Experiment 27: keyword boost against rank fusion

- **ID**: `27-retrieval-keyword-boost-vs-rrf-2026-10-18`
- **Category**: retrieval
- **Size**: Quick
- **Status**: INCONCLUSIVE (G6 failed); the boost helps, RRF not shown
- **Operator**: Dr Muhammad Aizat Bin Md Hawari, with Claude Code
- **Related**: [Experiment 24](../24-retrieval-memory-reranker-2026-10-17/report.md), [Experiment 26](../26-retrieval-threshold-fresh-prompts-2026-10-17/report.md), OpenSpec change `hook-search-keywords-and-profile` (design.md, decision 1), ADR-034
- **Approval**: Operator asked for this experiment on 2026-10-18. Operator approved the plan and the run on 2026-10-18.

## Answer

- **Question**: Does the keyword boost of 0.10, or RRF with the similarity cut-off applied first, find more relevant memories in the top 10 than meaning alone?
- **Answer**: The boost: yes. On 58 prompts with a relevant memory, recall@10 rises from 0.54 to 0.62 (+0.08; 21 wins, 8 losses, 29 ties) for 0.40 extra irrelevant memories per prompt. RRF: not shown. It reaches 0.68, which is +0.06 over the boost, but it adds 0.82 irrelevant memories per prompt, loses on more prompts than it wins against the boost (12 wins, 16 losses), and its edge shrinks to +0.003 when the newly judged pairs are counted at 0.4 weight (exploratory). (`output/summary.json`, `output/exploratory.json`)
- **Decision**: INCONCLUSIVE by the pre-set rule, because gate G6 failed (see Results). Keep `keywordBoost` at 0.1: the keep rule is met and the boost's extra memories are as relevant when judged by the old and the new judge. Do not propose a `keywordMode` setting for RRF now.
- **How sure**: Low to medium for the boost, low for RRF. One project, one store, 60 prompts used in earlier experiments, and AI-only labels from two judge runs that disagree on 9 of 40 repeated pairs. The labels are Haiku only: the operator's overrides in the merged Experiment 24 file are not used.
- **Next step**: To settle RRF, re-judge every pool pair with one judge in one run and repeat on fresh prompts (Experiment 26 set). The boost needs no further run before release.

## Plan (written before the run)

### Why

The keyword change keeps `keywordBoost` at 0.1, chosen by the size of the change it makes, not by quality. No test shows that word matches find more relevant memories. RRF is a published alternative that needs no score scale. This run compares both with meaning alone, on prompts and judged pairs that already exist.

### Data

- **Source**: the Experiment 24 snapshot (`memories.db`, 1,519 memories) and its 60 prompts (`sample.json`), read only. The saved copy is in the experiment outputs folder (`$OMMS_EXPERIMENT_OUTPUTS`, default `~/Development/PROJECTS/omms-experiment-outputs`).
- **Eligible memories**: created before the prompt and not from the prompt's own session. Same rule as Experiments 24 to 26.
- **Meaning score**: the Experiment 24 scorer (imported): 0.6 × content similarity + 0.4 × the larger of tag similarity and the tag-word match. Query embedding from `qwen3-embedding:0.6b` on port 9931.
- **Keyword score**: SQLite FTS5 over `content` and `tags`, tokenizer `unicode61`, score = −bm25. The query is built as in `buildKeywordQuery` (`src/services/turso/keyword-search.ts`), ported to Python. The index is built in a new file under `output/`. Only eligible memories count as hits. `best` is the best eligible score. At most 40 hits are kept, as in production (`max(limit × 4, 32)` with limit 10).

### Arms

Each arm returns at most 10 memories. Ties break by id.

- **A, meaning alone (baseline)**: rank by meaning score, drop scores below 0.50.
- **B, boost 0.10**: add `0.10 × min(1, score ÷ best)` to the meaning score of each keyword hit, cap at 1, rank, drop scores below 0.50. This is the production rule.
- **C, RRF with the cut-off first**: the vector list holds the eligible memories whose meaning score is 0.50 or more, ranked by meaning score. The keyword list holds the 40 keyword hits, ranked by keyword score. Fused score = 1 ÷ (60 + rank in vector list) + 1 ÷ (60 + rank in keyword list), with a missing list adding 0. Rank, take the top 10. No further cut-off, because fused scores have no absolute scale. A keyword hit below 0.50 can enter, which is the purpose of the mode.

The RRF constant 60 is the usual published value. It is fixed and not tuned.

### Answer key

- **Pool**: for each prompt, the union of the top-10 lists of A, B and C.
- **Existing labels**: pairs already judged in Experiment 24 keep their v2 label (`judge_labels_v2.jsonl`, Haiku only; the operator's 20 overrides are not applied).
- **New labels**: every other pool pair goes to blind Claude Haiku judges (no arm, rank or score; pairs shuffled), with the Experiment 26 rule: relevant means a concrete, usable link (same project, tool, file, bug, decision, convention or preference, or an earlier outcome that bears on the prompt). A shared general topic alone is not relevant.
- **Judge check**: 40 pairs from Experiment 24 are judged again (20 labelled relevant, 20 not relevant, chosen with seed 27). Their old and new labels are compared.
- **Operator**: labels nothing. All labels are AI labels.

### Measures

- **recall@10**: for each prompt with one or more relevant memories in the pool, relevant memories returned ÷ relevant memories in the pool. Mean over those prompts. The pool is shared, so the arms compare fairly. The number is relative to the pool, not to the whole store.
- **Noise**: irrelevant memories returned per prompt, over all 60 prompts.
- **Relevant per prompt**: relevant memories returned, over all 60 prompts.
- **Empty prompts**: prompts with no memory returned.
- **Wins, losses, ties**: per prompt, on recall@10, against the comparison arm.

Stats level: basic. No p-values.

### Hypotheses and rules (fixed before the run)

- **H1 (boost helps)**: B raises mean recall@10 by at least 0.03 over A, with at most 0.5 extra irrelevant memories per prompt.
- **H0 (boost)**: it does not.
- **Keep 0.1** when B's recall@10 is no more than 0.01 below A's and B's noise is at most 0.5 above A's, whether or not H1 holds. Otherwise report that the default needs a new look.
- **H2 (RRF is worth a setting)**: C raises mean recall@10 by at least 0.05 over B, with at most 1.0 extra irrelevant memories per prompt compared with B.
- **H0 (RRF)**: it does not. Then no `keywordMode` setting is proposed.

### Gates

| Gate                   | Pass when                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| G1 inputs unchanged    | Snapshot SHA-256 values equal those saved in Experiment 24 `sample.json`                           |
| G2 baseline reproduced | Arm A's top 10 before the cut-off equals Experiment 24 `A0` for all 60 prompts                     |
| G3 port matches        | `test_run.py` passes: the Python query builder gives the same strings as `buildKeywordQuery` tests |
| G4 coverage            | At least 40 of 60 prompts have one or more relevant memories in the pool                           |
| G5 completeness        | Every pool pair has a label                                                                        |
| G6 judge stability     | The new judge repeats at least 34 of 40 old labels, and at least 15 of 20 in each group            |

If any gate fails, the result is INCONCLUSIVE. AI-only labels also keep validity INCONCLUSIVE. This run cannot approve a production change by itself.

### Run

From the worktree root, one script, three phases:

1. `python3 experiments/27-retrieval-keyword-boost-vs-rrf-2026-10-18/run.py arms` (60 query embeddings on port 9931; builds `output/keywords.db`; checks G1 and G2; writes `output/arms.json`)
2. `... run.py pool` (writes `output/judge_input.jsonl` and `output/judge_part*.jsonl` for new pairs and the 40 check pairs); then Haiku judges write `output/judge_labels_part*.jsonl`
3. `... run.py summarise` (checks G4 to G6; writes `output/summary.json`)

## Results

Run on 2026-10-18. Phase 1 reproduced Experiment 24's baseline top 10 for all 60 prompts (G1 and G2 pass, `output/arms.json`). The pool held 923 pairs. 577 already had Experiment 24 v2 Haiku labels (the AI-only part files, `judge_labels_v2_part*.jsonl`). Three Haiku judges labelled the other 306 pairs and 40 repeat checks (346 labels; `output/judge_labels_part*.jsonl`). 58 of 60 prompts have a relevant memory in the pool (G4 pass). Every pool pair has a label (G5 pass). The query-builder port passes 16 tests that include the cases from `tests/keyword-search-pure.test.ts` (G3 pass).

**G6 failed.** The new judge repeated 19 of 20 old "relevant" labels but only 12 of 20 old "not relevant" labels (31 of 40; the rule needed 34, and 15 of 20 in each group). The new judge is more generous than the old one. (`output/summary.json`, `judge_check_agreement`)

Source: `output/summary.json`. Noise is irrelevant memories per prompt over all 60 prompts.

| Arm                      | recall@10 | Relevant per prompt | Noise per prompt | Empty prompts |
| ------------------------ | --------: | ------------------: | ---------------: | ------------: |
| A, meaning alone         |     0.542 |                6.60 |             1.83 |             4 |
| B, boost 0.10            |     0.624 |                6.93 |             2.23 |             3 |
| C, RRF, cut-off first    |     0.684 |                6.95 |             3.05 |             0 |

| Comparison | recall difference | Noise difference | Wins / losses / ties |
| ---------- | ----------------: | ---------------: | -------------------- |
| B against A |            +0.082 |            +0.40 | 21 / 8 / 29          |
| C against B |            +0.060 |            +0.82 | 12 / 16 / 30         |
| C against A |            +0.142 |            +1.22 | 21 / 15 / 22         |

Pre-set outcomes (void while G6 fails): H1 for the boost is met (gain 0.082 at least 0.03, noise +0.40 at most 0.5). The keep rule is met. H2 for RRF is met on its two numbers (gain 0.060 at least 0.05, noise +0.82 at most 1.0).

**Exploratory check (post-hoc, not in the plan).** Because the new judge is more generous, the 306 newly judged pairs may flatter arms B and C, which return most of them. (`output/exploratory.json`)

- Memories that arm B returns and arm A does not: 69% relevant when judged by the old judge (72 of 105), 68% when judged by the new judge (89 of 130). No sign of inflation for B.
- The same for arm C: 77% by the old judge (66 of 86), 59% by the new judge (159 of 270). The new judge finds C's extra memories less relevant, not more.
- Recall when the newly judged pairs count at a weight (all labels from Experiment 24 keep full weight):

| Weight of new labels | A     | B     | C     |
| -------------------- | ----: | ----: | ----: |
| 1.0 (as judged)      | 0.542 | 0.624 | 0.684 |
| 0.6                  | 0.594 | 0.635 | 0.661 |
| 0.4                  | 0.627 | 0.643 | 0.646 |

B stays ahead of A at every weight, by a shrinking margin. C's lead over B falls from 0.060 to 0.026 at weight 0.6 and to 0.003 at weight 0.4, which is a tie. The weights are chosen by hand and are not a measured correction.

## Limits

1. The keyword score is a Python port of the TypeScript query builder on an FTS5 index built outside OMMS. The unit test checks the query strings, not every score. Production ranks only vector candidates and keyword hits; this run ranks the whole eligible store. G2 shows that arm A matches.
2. All labels are AI labels. Old and new labels come from different judge runs and do not agree (G6). The exploratory check does not fix this. A clean answer needs one judge for every pair.
3. The first summary used the merged `judge_labels_v2.jsonl`, which holds the operator's overrides from Experiment 24. A review found this differed from the plan. The summary and the exploratory check were re-run on the AI-only part files, and every figure above comes from that re-run. The conclusions did not change.
4. The same 60 prompts and 1,519 memories were used in Experiments 24 to 26. The choice of 0.10 was made before this run, so the run tests it, but it is still one project, one embedding model and one store.
5. recall@10 is relative to the pool of the three arms. A memory that no arm returned is not counted.
6. RRF with the cut-off applied to every candidate, keyword hits included, only reorders arm A's memories, so it was not tested. RRF constant 60 was fixed and not tuned.
