# Experiment 11: catalogue consolidation replay and the new scoring ruler

- **ID**: `11-retrieval-catalogue-consolidation-replay-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: FAIL — H1 does not hold; post-hoc exploratory (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with implementation and agent sessions
- **Related**: [protocol](protocol.md); Experiments 06, 09 and 10

## Answer

- **Question**: How much of Experiment 06's wrong label reuse disappears when confusable labels merge into a smaller catalogue built from development evidence only?
- **Answer**: Almost none. At 20 labels, 1 of 13 label-versus-label wrong picks becomes correct; H1 needed 7. Wrong reuse moves from 57.75% to 56.34%. Source: `output/summary.json`, keys `h1` and `counts`.
- **Decision**: Keep the 41-label catalogue for Experiment 12. Merging labels by definition similarity is not the lever. The acceptable-label sets and the two-tier ruler stand for later experiments.
- **How sure**: Clear on direction, because the gap is large (1 against 7). Post-hoc exploratory: the Experiment 06 answers were already inspected. Validity for production is INCONCLUSIVE: development labels are AI-authored and the test reference is operator-arbitrated.
- **Next step**: Plan Experiment 12, the neighbour check against reviewed members. It targets the 28 wrong picks on `none_fit` cases, which no merge can change.

## What ran

1. `--phase build` built three merge maps from the Experiment 09 Clef development scores (1,230 pairs, 60 cases). It also built the acceptable-label sets from the Experiment 10 disputes. One case widened. Source: `output/build.json`.
2. `--phase score` replayed the 140 saved Experiment 06 answers through five cells. No model calls. Source: `output/cells/`, `output/summary.json`.
3. `--phase verify` rebuilt everything in memory and matched the saved files with zero writes.

## Results

### Wrong reuse by catalogue size

E is accepted reuse picks, C is correct, W is wrong. U95 is the exact one-sided 95% upper bound on W/E.

| Cell | Labels | Scoring          | E   | C   | W   | W on `none_fit` | W label vs label | W/E    | U95    | Tier 1 |
| ---- | ------ | ---------------- | --- | --- | --- | --------------- | ---------------- | ------ | ------ | ------ |
| C0   | 41     | single reference | 71  | 29  | 42  | 28              | 14               | 59.15% | 69.02% | fail   |
| C1   | 41     | acceptable sets  | 71  | 30  | 41  | 28              | 13               | 57.75% | 67.70% | fail   |
| C2   | 30     | acceptable sets  | 71  | 31  | 40  | 28              | 12               | 56.34% | 66.37% | fail   |
| C3   | 20     | acceptable sets  | 71  | 31  | 40  | 28              | 12               | 56.34% | 66.37% | fail   |
| C4   | 12     | acceptable sets  | 71  | 35  | 36  | 28              | 8                | 50.70% | 61.00% | fail   |

Source: `output/summary.json`, key `counts`.

The 28 wrong picks on `none_fit` cases never move, as the plan predicted. Even 12 labels fix only 5 of 13 confusions. At that level one preference label swallows 12 original labels and 61% of the section's positive cases.

### Hypothesis and gates

| Item               | Result                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| H1 (primary)       | does not hold: 1 of 13 fixed at L20; 7 needed                              |
| G1 integrity       | pass: all 10 pins verified before and after; build hash recorded first     |
| G2 completeness    | pass: 140 outcomes in every cell                                           |
| G3 reproduction    | pass: C0 gives E 71, C 29, W 42                                            |
| G4 build blindness | pass: the focused test injects a test record and sees a refusal            |
| G5 guardrail       | fail: at L20 one pattern label holds 33.3% of its section's positive cases |

Source: `output/summary.json`, keys `h1`, `gates` and `guardrail_largest_share`. G4 source: `test_run_eval.py`.

By the decision rule, H1 failing means FAIL. The G5 failure adds that L20 already merges 5 pattern labels and 7 preference labels into single groups.

### Why merging did not help

The classifier's test confusions are mostly not the pairs that look alike on development data. Each confused pair's development similarity was ranked against all 402 same-section pairs. Only 2 of 13 sit in the top fifth (97th and 87th percentile). The middle pair sits at the 62nd percentile, close to the 50th that random pairs would give. Source: `analysis.py`, from `output/build.json` and `output/summary.json`.

So the wrong picks are scattered rather than concentrated on neighbouring definitions. A catalogue built to separate neighbours would not remove them.

### Acceptable-label sets

One case widened: `c6e26d6c…`, with `pattern_agent_orchestration` and `pattern_configuration_tuning`. These two labels stay apart even at L20. The other 9 remaining disputes set a label against `none_fit` or `uncertain`, so they do not widen. Source: `output/build.json`, key `widened_cases`.

## Limits

- Post-hoc exploratory: the Experiment 06 answers were inspected before this plan.
- A replay assumes the classifier picks the same original label on a merged catalogue. A real re-run with merged definitions could differ in either direction.
- The merge signal is Clef's view of AI-written definitions, from 1 to 4 development cases per label. Another signal could cluster differently.
- The test reference is operator-arbitrated, not blind solo human review.

## What this means for Experiments 12 and 13

- Use 41 labels and the acceptable-label sets.
- Use the two-tier ruler from `plan.json`: Tier 1 needs W = 0 and C ≥ 29 on the 140 cases. Tier 2 needs U95 ≤ 5% on fresh data.
- The main target is the 28 picks made where no label fits. A gate must learn to say `none_fit` or route to review. Better label boundaries will not do it.
