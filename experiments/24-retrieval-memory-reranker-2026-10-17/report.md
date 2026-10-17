# Experiment 24: reranker for memory retrieval, report

- **ID**: `24-retrieval-memory-reranker-2026-10-17`
- **Status**: FAIL (guardrail L, reranker delay). Validity INCONCLUSIVE (AI answer key).
- **Plan**: [protocol.md](protocol.md), frozen values in [plan.json](plan.json)
- **Run date**: 2026-10-17

## Answer

- **Question**: Does a reranker over the top 50 memories find more relevant memories in the final 10 than the current scorer?
- **Answer**: Yes on paper, but the gain comes from removing the 0.6 cut-off, not from the reranker. Arm B (reranker) beat Arm A (current scorer) by 0.32 recall@10. Arm A0 (top 10, no cut-off, no reranker) already reached 0.66. The reranker added 0.02 over A0, which is within noise.
- **Decision**: Do not add a reranker stage now. The reranker also fails the delay limit: median 2.5 seconds per prompt, p95 9.5 seconds, against a limit of 0.5 seconds. Follow up on the cut-off in Experiment 25.
- **How sure**: Low to medium. The answer key is AI-made and was checked on 20 pairs only. The check passed at the exact line (16 of 20) after the judge rule changed once.
- **Next step**: Experiment 25 (done) shows the cut-off is the main cause. Re-test the reranker only on top of a lower cut-off, with a smaller pool, on fresh prompts.

## Results

Source: `output/summary_v2.json` (final key, v2), `output/summary.json` (first key, strict).

53 of 60 prompts have at least one relevant memory in the pool (v2). 48 of 60 under the strict key.

| Arm                                | recall@10 (v2) | precision (v2) | recall@10 (strict) |
| ---------------------------------- | -------------: | -------------: | -----------------: |
| A: current scorer, 0.6 cut-off     |          0.363 |          0.639 |              0.409 |
| A0: top 10, no cut-off             |          0.662 |          0.787 |              0.656 |
| B: reranker over top 50, keep 10   |          0.681 |          0.813 |              0.752 |

| Comparison | Gain (v2) | Wins / losses / ties (v2) | Sign test p (v2) | Gain (strict) | Sign test p (strict) |
| ---------- | --------: | ------------------------: | ---------------: | ------------: | -------------------: |
| B minus A  |     0.318 |                 36 / 1 / 16 |          5.5e-10 |         0.344 |              6.0e-07 |
| B minus A0 |     0.019 |                 16 / 11 / 26 |             0.44 |         0.096 |                 0.058 |

B minus A0 is exploratory. Its p-values come from a two-sided sign test I ran after the main summary. They are not in `summary_v2.json`.

| Gate or guardrail          | Result (v2)                         |
| -------------------------- | ----------------------------------- |
| G1 integrity, G2 embedding | Pass (`output/check.json`)          |
| G3 coverage                | Pass: 53 of 60 prompts, need 40     |
| G4 completeness            | Pass: 60 prompts, 0 errors          |
| G5 key check               | Pass at the line: 16 of 20 (see below) |
| Guardrail P (precision)    | Pass: B 0.813 against A 0.639       |
| Guardrail L (delay)        | **Fail**: median 2.46 s, p95 9.52 s |

H1 holds (gain at least 0.05, p below 0.05). The decision rule needs H1, P and L together. L fails, so the pre-set outcome is FAIL: keep the current scorer.

Arm A returned nothing for 21 of 60 prompts, because no memory scored 0.6 or more. Arm A returned 4.8 memories per prompt on average.

## What this means

- **Is it actionable?** Yes, in a limited way. Do not adopt the reranker. Look at the cut-off instead (Experiment 25).
- **Why the reranker is not the cause of the gain**: A0 uses no reranker and reached 0.66. The reranker moved this to 0.68 on the v2 key (p 0.44) and 0.75 on the strict key (p 0.058). The two keys disagree on the reranker's extra value. That is a reason to wait, not to adopt.
- **Cost if adopted later**: about 2.5 seconds extra on a typical prompt, and a second model server to run on every host. Retrieval runs on every prompt, so this is a large cost.

## Amendments and deviations

The plan was frozen before the run. These changes were made after results were seen. They are recorded here, not in `plan.json`.

1. **G5 failed on the first key.** The operator agreed with the strict AI judge on 12 of 20 pairs (`output/spot_check.json`). All 8 disagreements were "operator relevant, AI not relevant".
2. **Judge rule changed twice.** First rule ("would help the agent") made Haiku answer relevant for all 20 check pairs, which is not useful. Second rule ("a concrete, usable link") gave 17 of 20 on the same pairs. Both runs used the same 20 pairs the operator had already labelled, so the rule was tuned on its own test set. The full run (Haiku, medium effort, 5 parts) then agreed with the operator on 16 of 20.
3. **Final key v2** (`output/judge_labels_v2.jsonl`): Haiku labels for all 940 pairs, with the operator's 20 labels overriding. 643 of 940 pairs are relevant, against 370 under the strict key. The strict key is kept as a sensitivity check (`output/summary.json`).
4. **Judge model**: the plan said a Claude subagent. The first key used Sonnet. The v2 key used Haiku. The two keys use different models and different rules, so they are not a clean comparison.
5. **`summarise.py`** now takes an optional `v2` argument that selects the label file and the summary file name.

## Limits

1. The answer key is AI-made. The operator checked 20 pairs. The check passed only at the threshold, so validity is INCONCLUSIVE. This report cannot approve a production change.
2. The judge rule was tuned after seeing the operator's labels (amendment 2).
3. 60 prompts from one project (omms) and one embedding model (`qwen3-embedding:0.6b`).
4. The reranker ran on the operator's laptop. Delay on other hardware will differ. The test was not run with a smaller pool.
5. Recall counts only memories that reached the pool. A relevant memory that neither arm found is not counted.
