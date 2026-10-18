# Experiment 28: RRF against the boost with one judge, on two prompt sets

- **ID**: `28-retrieval-rrf-one-judge-fresh-prompts-2026-10-18`
- **Category**: retrieval
- **Size**: Quick
- **Status**: PLANNED
- **Operator**: Dr Muhammad Aizat Bin Md Hawari, with Claude Code
- **Related**: [Experiment 27](../27-retrieval-keyword-boost-vs-rrf-2026-10-18/report.md), [Experiment 26](../26-retrieval-threshold-fresh-prompts-2026-10-17/report.md), [Experiment 24](../24-retrieval-memory-reranker-2026-10-17/report.md), ADR-034
- **Approval**: Operator asked for this plan on 2026-10-18. Run approval is still to be given.

## Answer

(Fill in after the run.)

- **Question**: When one judge labels every pair, does RRF (cut-off applied first) find more relevant memories in the top 10 than the keyword boost of 0.10, on the Experiment 24 prompts and on the Experiment 26 fresh prompts?
- **Answer**:
- **Decision**:
- **How sure**:
- **Next step**:

## Plan (written before the run)

### Why

Experiment 27 was INCONCLUSIVE. Its newly judged pairs came from a more generous judge than its old pairs (gate G6: 31 of 40 repeated labels agreed, 34 needed). RRF's lead over the boost (+0.054) shrank to +0.018 under a sensitivity check. The keyword change ships `keywordMode: "rrf"` as an experimental option, so the operator needs to know whether it earns a stable place. This run removes the judge mix-up and adds a second prompt set.

### Data

- **Set A**: the 60 Experiment 24 prompts. The arms are the saved ones from Experiment 27 (`output/arms.json`, read only).
- **Set B**: the 60 fresh prompts of Experiment 26 (`sample.json`, read only). No prompt or session is in Set A. The arms are made by the Experiment 27 functions against the same snapshot.
- **Scorer, keyword index, arms A, B and C**: exactly as in Experiment 27. Cut-off 0.50, boost 0.10, RRF constant 60, top 10.

### Answer key

- **One judge, one run.** Claude Haiku subagents with the Experiment 27 rule, wording unchanged: relevant means a concrete, usable link (same project, tool, file, bug, decision, convention or preference, or an earlier outcome that bears on the prompt). A shared general topic alone is not relevant. Blind: no arm, rank or score. Pairs are shuffled across both sets and across parts.
- **Set A pairs**: the 577 pool pairs that only have Experiment 24 labels are judged again. The 306 pairs judged in Experiment 27 keep their labels, because the same rule and model judged them. The Experiment 24 labels are not used.
- **Set B pairs**: every pool pair (the union of the top-10 lists of A, B and C), about 920.
- **Stability check**: 40 pairs (20 labelled relevant, 20 not, chosen with seed 28 from the Experiment 27 labels) are placed in two different parts and judged twice. The two answers are compared.
- **Operator**: labels nothing. All labels are AI labels.
- **Cost**: about 1,540 pairs in 11 parts of about 140. That is 11 Haiku subagents, roughly 2.3 million tokens.

### Measures

As in Experiment 27, for each set and for both sets together: recall@10 on prompts with one or more relevant memories in the pool, relevant memories per prompt, irrelevant memories per prompt, empty prompts, and wins, losses and ties on recall@10. Stats level: basic. No p-values.

### Hypotheses and rules (fixed before the run)

- **H1 (RRF earns a stable place)**: on **each** set, C raises mean recall@10 by at least 0.05 over B, with at most 1.0 extra irrelevant memories per prompt compared with B.
- **H0**: it does not hold on both sets.
- **Outcome if H1 holds**: the `(experimental)` label may be dropped, and the operator decides whether to make RRF the default.
- **Outcome if H1 fails on one or both sets**: keep the label, or remove the option. The operator decides.
- **Side result (not a decision rule)**: B against A on each set, to confirm that the boost helps with one judge.

### Gates

| Gate                 | Pass when                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| G1 inputs unchanged  | Snapshot SHA-256 values equal those saved in Experiment 24 `sample.json`                              |
| G2 baseline matches  | Arm A on Set B equals the Experiment 26 saved top 10 at the 0.50 cut-off for all 60 prompts           |
| G3 port matches      | The Experiment 27 `test_run.py` passes                                                                |
| G4 coverage          | At least 40 of 60 prompts in each set have one or more relevant memories in the pool                  |
| G5 completeness      | Every pool pair has a label                                                                           |
| G6 judge stability   | The two judgements of the 40 repeated pairs agree on at least 36, and on at least 16 of 20 per group  |

If any gate fails, the result is INCONCLUSIVE. AI-only labels also keep validity INCONCLUSIVE. This run cannot approve a production change by itself.

### Run

From the worktree root, one script, three phases:

1. `python3 experiments/28-retrieval-rrf-one-judge-fresh-prompts-2026-10-18/run.py arms` (60 query embeddings on port 9931; checks G1 and G2; writes `output/arms_b.json`)
2. `... run.py pool` (writes `output/judge_part*.jsonl`); then Haiku judges write `output/judge_labels_part*.jsonl`
3. `... run.py summarise` (checks G4 to G6; writes `output/summary.json`)

## Results

(Fill in after the run.)

## Limits

1. The prompts of Set A were used in Experiments 24 to 27. The prompts of Set B were used in Experiment 26 only, for the threshold.
2. All labels are AI labels from one model and one rule. A different rule could change the order of the arms.
3. recall@10 is relative to the pool of the three arms.
4. The keyword score comes from a Python port. Production ranks only vector candidates and keyword hits.
5. The RRF constant 60 is fixed and not tuned.
