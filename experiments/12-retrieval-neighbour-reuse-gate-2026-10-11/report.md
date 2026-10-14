# Experiment 12: neighbour check against reviewed members

- **ID**: `12-retrieval-neighbour-reuse-gate-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: FAIL — safe but starved; H1 does not hold (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with implementation and agent sessions
- **Related**: [protocol](protocol.md); Experiments 01, 06, 10, 11 and 13

## Answer

- **Question**: Can a gate that compares each observation with already-labelled observations reuse labels with zero wrong picks and at least 29 correct on the 140 test cases?
- **Answer**: No. The gate made no wrong picks, but it accepted only 1 case. It parked the other 139, including all 28 cases where Experiment 06 forced a wrong label. Tier 1 needs 29 correct. Source: `output/summary.json`, key `counts`.
- **Decision**: The neighbour gate alone is not a reuse mechanism at today's data size. Do not run Experiment 13 as planned (see "What this means for Experiment 13").
- **How sure**: Sure on the frozen result. The exploratory checks point the same way: even much looser rules get roughly as many wrong as right.
- **Next step**: Decide with the operator between the options in "Next".

## What ran

1. `--phase run` split the 140 test cases into 5 folds by group. For each fold it chose a threshold rule inside the other cases only, then decided each held-out case once. No model calls: it used the cached Experiment 01 vectors.
2. The same phase ran the preregistered learning curve, the holding-pen count, the paired comparison with Experiment 06 and the exploratory grid.
3. `--phase verify` rebuilt every output in memory and matched the saved files with zero writes.

Focused tests: 11 pass. 11 deliberate faults in throwaway copies each made at least one test fail.

## Results

### Frozen result

| Measure                      | Value                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Accepted picks (E)           | 1                                                     |
| Correct (C)                  | 1                                                     |
| Wrong (W)                    | 0                                                     |
| Parked                       | 139                                                   |
| Tier 1 (W = 0 and C ≥ 29)    | fail                                                  |
| Rules chosen per fold (τ, δ) | 0.75/0.08 in folds 0 to 2; 0.55/0.05 in folds 3 and 4 |
| Inner correct per fold       | 1, 1, 1, 1 and 3, all with zero inner wrong           |

Source: `output/summary.json`, keys `counts`, `rules` and `inner_best`.

### Gates

| Gate            | Result                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| G1 integrity    | pass: all 7 pins verified before and after                                |
| G2 completeness | pass: 140 held-out decisions, one each                                    |
| G3 fold hygiene | pass: groups never split; the focused tests inject leaks and see refusals |
| G4 Tier 1       | fail: C = 1                                                               |

### Learning curve

Mean correct picks across 3 seeds: 0 at 25% of the gallery, 1 at 50%, 2 at 75%, and 1 with the full gallery. The plan calls the curve rising only if the full gallery beats 50% by at least 5. It does not rise. Source: `output/summary.json`, key `learning_curve`.

### Paired with Experiment 06

- The gate parked all 28 of Experiment 06's wrong picks on `none_fit` cases.
- It kept 1 of Experiment 06's 30 correct picks.

Source: `output/summary.json`, key `paired_experiment06`.

### Why it starved (exploratory)

These checks look at the test cases directly, so they are exploratory. Source: `analysis.py`, from `output/predictions.json`.

- **The frozen rule could rarely fire.** Only 2 of 140 cases had 3 nearest neighbours sharing one existing label. Each label has a median of 3 labelled examples in total, and some of those are held out in any fold. Requiring 3 agreeing neighbours was too strict for this data size. That was a planning error.
- **Looser rules are not safe either.** With only the single nearest neighbour, wrong picks match or exceed correct ones at every threshold tried: 28 correct and 63 wrong at τ 0.6; 8 and 8 at τ 0.74.
- **The embeddings do not separate the labels.** The nearest neighbour carries an acceptable label for 32 of 67 labelled cases. On 46 of 73 `none_fit` cases, it carries an existing label. Nearest similarities sit in a narrow band, about 0.54 to 0.79.

The embedding groups observations by topic, such as "npm release". The labels describe the user's intent, such as "wants approval before acting". Two observations on one topic can carry different labels. That is why closeness predicts the label only about half the time.

### Holding pen

The 139 parked cases form 86 groups at the fold thresholds. Two groups hold 3 or more cases and cover 53 cases between them, by chaining loosely linked items. These groups are too coarse for one-decision-per-group review. Source: `output/summary.json`, key `holding_pen`.

## Plan gap, recorded honestly

The decision rule covered three branches: pass; W = 0 with a rising curve; and W > 0. This result is W = 0 with a flat curve, which no branch named. H1 fails, so the status is FAIL. The plan was not changed after the run.

## Limits

- Development labels in every gallery are AI-authored; the test reference is operator-arbitrated.
- One embedding model, `qwen3-embedding:0.6b`. A larger or instruction-tuned embedder might separate intent better. This experiment cannot tell.
- About 3 examples per label. Any instance method needs more reviewed members than this.

## What this means for Experiment 13

Experiment 13 proposes the nearest neighbour's label and asks Clef to confirm it. The nearest neighbour is acceptable for only 32 of 67 labelled cases. So Experiment 13 can reach at most 32 correct, and it needs 29 with zero wrong. Clef would have to accept 29 of those 32 and reject all 81 other proposals, including 46 on `none_fit` cases. That is very unlikely. Running it as planned would spend 280 calls to confirm a near-certain fail.

## Next

Options for the operator:

1. Accept the current design: first assignment goes to review, and only reviewed repeats are reused (the `review-first-assignment` proposal). Revisit automatic reuse when each label has many more reviewed members.
2. Redesign Experiment 13 so Clef judges intent across all same-section labels, with neighbours as examples only. This needs a new plan before any call.
3. Test a stronger local embedder, or an instruction prompt that targets intent, on the cached task. That needs a download and a new plan.
