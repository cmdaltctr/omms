# Experiment 26: threshold check on fresh prompts

- **ID**: `26-retrieval-threshold-fresh-prompts-2026-10-17`
- **Category**: retrieval
- **Size**: Quick
- **Status**: INCONCLUSIVE (G5 failed); H1 holds on every key
- **Operator**: Dr Muhammad Aizat Bin Md Hawari, with Claude Code
- **Related**: [Experiment 25](../25-retrieval-threshold-sweep-2026-10-17/report.md), [Experiment 24](../24-retrieval-memory-reranker-2026-10-17/report.md), `similarityThreshold` in `src/config.ts`
- **Approval**: Operator asked for this run on 2026-10-17.

## Answer

- **Question**: Does the Experiment 25 result hold on prompts that no earlier experiment used? That result: a threshold of 0.50 or 0.55 lifts recall@10 by at least 0.10 over 0.60 at a cost of at most 2 extra irrelevant memories per prompt.
- **Answer**: Yes. On 60 fresh prompts, 0.50 lifts recall@10 from 0.54 to 0.88 (AI key) with 1.85 extra irrelevant memories per prompt, and the pick rule chooses 0.50. The same holds with the operator's 40 labels applied on top (0.50 to 0.89, 1.72 extra). 22 of 60 prompts got no memory at 0.60, against 6 at 0.50.
- **Decision**: INCONCLUSIVE by the pre-set rule, because gate G5 failed (23 of 40 agreed; 30 needed). The threshold result does not depend on that failure: the AI-only key, which the operator prefers, gives the same pick as the key with the operator labels applied. Recommend 0.50 as the new default, to be confirmed by the operator.
- **How sure**: Medium. Two independent prompt sets agree, and so do three label sets. Still one project, one embedding model, one memory store and AI-made labels.
- **Next step**: Operator decides whether to accept 0.50 given the failed G5. Then write the OpenSpec change for the new default (editable in the Memory card).

## Plan (written before the run)

### Why

Experiment 25 chose its thresholds after the operator saw Experiment 24 results on the same 60 prompts. The answer key was AI-made and passed the operator check only at the line (16 of 20). A default in `src/config.ts` needs a result that did not come from those prompts.

### Data

- **Source**: the Experiment 24 snapshot (`memories.db`, `user-prompts.db`), read only. The memory store is the same one. The prompts are new.
- **Fresh prompts**: omms prompts of 40 or more characters that are not in the Experiment 24 sample **and** whose session is not in the Experiment 24 sample. 161 such prompts remain after a limit of 2 per session. Take 60 with seed 26.
- **Eligible memories**: created before the prompt and not from the prompt's own session. Same rule as Experiment 24.
- **Scorer**: the Experiment 24 scorer (imported, not copied): content similarity 0.6 plus tag similarity 0.4, query embedding from `qwen3-embedding:0.6b` on port 9931.

### Arms

Every arm takes the top 10 memories by score, then drops those below the threshold. Only the threshold changes: 0.60 (baseline), 0.55, 0.50, 0.45.

### Answer key

- **Pool**: top-10 memories with a score of 0.45 or more. No arm can return a memory below 0.45, so none needs a label.
- **Judge**: Claude Haiku at medium effort, blind (no arm, rank or score), same rule as the Experiment 24 v2 key: relevant means a concrete, usable link (same project, tool, file, bug, decision, convention or preference, or an earlier outcome that bears on the prompt). A shared general topic alone is not relevant. Pairs are shuffled.
- **Operator check**: 40 pairs. 20 chosen at random from AI "relevant", 20 from AI "not relevant". The first check had 18 of 20 relevant, which cannot show whether the judge can say "no".

### Measures

Same as Experiment 25: recall@10 on prompts with at least one relevant memory in the pool, irrelevant memories per prompt over all 60 prompts, empty prompts, and wins, losses and ties per prompt against 0.60. Stats level: basic. No p-values.

### Hypothesis and rule (fixed before the run)

- **H1**: 0.50 raises mean recall@10 by at least 0.10 over 0.60, with at most 2.0 extra irrelevant memories per prompt.
- **H0**: it does not.
- **Pick rule**: among arms that meet the same two limits, choose the highest threshold whose recall is within 0.03 of the best such arm.
- **Holds** when H1 is met for 0.50 and the pick is 0.50 or 0.55. A different pick, or H1 not met for 0.50, means it does not hold.

### Gates

| Gate                | Pass when                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| G1 inputs unchanged | Snapshot SHA-256 values equal those saved in Experiment 24 `sample.json`                                        |
| G2 fresh            | None of the 60 prompt ids or session ids is in the Experiment 24 sample                                         |
| G3 coverage         | At least 40 of 60 prompts have one or more relevant memories in the pool                                        |
| G4 completeness     | Every pool pair has a judgement                                                                                 |
| G5 key check        | Operator agrees with the AI on at least 30 of 40 pairs, and on at least 12 of 20 in each of the two groups      |

If G5 is not met or not done, the result is INCONCLUSIVE. AI-only labels also keep validity INCONCLUSIVE. This run cannot approve a production change by itself.

### Run

From the worktree root, one script, four phases:

1. `python3 experiments/26-retrieval-threshold-fresh-prompts-2026-10-17/run.py sample`
2. `... run.py score` (60 query embeddings on port 9931; no reranker)
3. `... run.py pool` (writes `output/judge_input.jsonl` and `output/judge_part*.jsonl`); then Haiku judges write `output/judge_labels_part*.jsonl`
4. `... run.py summarise`

## Results

Run on 2026-10-17. Gates G1 and G2 passed (`output/sample.json`): snapshot unchanged, none of the 60 prompt ids or sessions is in the Experiment 24 sample. 60 fresh prompts were drawn from 383 candidates. 552 pairs were judged by three Haiku runs (`output/judge_labels_part*.jsonl`). One pair (`q0220`) was labelled twice with the same answer.

Sources: `output/summary_ai_only.json` (AI labels only) and `output/summary.json` (AI labels, with the operator's 40 labels overriding). Noise is irrelevant memories per prompt over all 60 prompts.

AI key only (334 of 552 pairs relevant; 51 prompts with a relevant memory):

| Threshold | recall@10 | Difference from 0.60 | Noise per prompt | Noise difference | Empty prompts | Wins / losses / ties |
| --------- | --------: | -------------------: | ---------------: | ---------------: | ------------: | -------------------- |
| 0.60      |     0.541 |                    – |             0.92 |                – |            22 | –                    |
| 0.55      |     0.719 |               +0.179 |             1.75 |            +0.83 |            16 | 19 / 0 / 32          |
| 0.50      |     0.884 |               +0.343 |             2.77 |            +1.85 |             6 | 26 / 0 / 25          |
| 0.45      |     1.000 |               +0.459 |             3.63 |            +2.72 |             3 | 30 / 0 / 21          |

With the operator's 40 labels applied (341 relevant; 54 prompts with a relevant memory): 0.60 gives recall 0.503; 0.55 gives 0.695 (+0.191, noise +0.80); 0.50 gives 0.892 (+0.389, noise +1.72); 0.45 gives 1.000 (+0.497, noise +2.60). Empty prompts are the same.

The 0.45 recall of 1.000 is by construction. The pool holds only memories scoring 0.45 or more, so the 0.45 arm contains every relevant memory in it. Do not read it as a result.

H1 (gain at least 0.10, extra noise at most 2.0): met by 0.55 and 0.50 on both keys. 0.45 fails on noise. The pick rule gives **0.50** on both keys.

Gate results:

| Gate                | Result                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| G1 inputs unchanged | Pass                                                                                                       |
| G2 fresh            | Pass                                                                                                       |
| G3 coverage         | Pass: 51 of 60 prompts (54 with operator labels), need 40                                                  |
| G4 completeness     | Pass: 552 pairs, 0 missing                                                                                 |
| G5 key check        | **Fail**: 23 of 40 agreed (need 30). AI "relevant" 15 of 20 agreed (need 12). AI "not relevant" 8 of 20 (need 12) |

The 17 disagreements: in 12 the operator marked relevant where the AI said not relevant, and in 5 the reverse (`output/spot_check.json`).

## What this means

- **Is it actionable?** Yes. The 0.60 default loses relevant memories on fresh prompts too, and 0.50 fixes most of it.
- **Adopt?** Needs a decision. G5 failed, so by the plan this is INCONCLUSIVE. My reading: adopt 0.50, because the pick does not change with whose labels are used. The risk is bounded: about 1.7 to 1.9 more irrelevant memories per prompt, and the setting stays editable.
- **The operator and the AI disagree on both sides.** The operator did not simply mark everything relevant (27 of 40 relevant). The operator's view of the AI's "not relevant" pairs was the weak point: 12 of 20 were relevant to the operator. The operator suggested the AI may be the more accurate judge. This check cannot show that. It shows the two differ, and neither is a verified reference.
- **Cost of the change**: one default in `src/config.ts`, docs that name 0.6, and an OpenSpec change. Token cost was not measured.

## Amendments

1. `run.py` gained phases `spotcheck` and `ingest`, and an `ai` argument for `summarise`, after the plan was written. They only build the check page, read its answers, and run the summary without the operator override. `spotcheck` also removes memories with more than 2% non-ASCII characters or a French marker word (`utilisateur`, `Demande`, `Résultat`, `Résultats`) before it samples 20 pairs from each AI label group, because the page has no translation step. The sample is random only among the remaining readable memories, so French and other non-English memories are not represented in the 40 pairs. The number removed was not recorded.
2. The plan said the operator's labels override the AI. Both results are reported because G5 failed.
3. After the run the operator said to trust the AI judge more than the operator's own labels. The main result is therefore the AI-key-only run (`output/summary_ai_only.json`: pick 0.50, H1 met). The run with the operator's 40 labels applied (`output/summary.json`) is a sensitivity check. G5 stays recorded as failed, because the plan set it before the run. Validity stays INCONCLUSIVE for production approval, since the key is AI-made and no human label set agrees with it closely enough.


## Limits

1. One project (omms), one embedding model, and the memory store is the same as in Experiments 24 and 25.
2. The fresh prompts come from the same weeks and the same user as the first 60. They test new prompts, not a new period.
3. AI-made answer key. Haiku with the v2 rule agreed with the operator on 16 of 20 in Experiment 24.
4. Recall counts only memories in the pool (top 10 with score 0.45 or more).
