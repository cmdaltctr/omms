# Experiment 14: neighbour gate with 1 or 2 neighbours

- **ID**: `14-retrieval-neighbour-gate-fewer-neighbours-2026-10-11`
- **Category**: retrieval
- **Size**: Quick
- **Status**: FAIL — post-hoc exploratory (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [Experiment 12 report](../12-retrieval-neighbour-reuse-gate-2026-10-11/report.md)

## Answer

- **Question**: Does the Experiment 12 neighbour gate pass Tier 1 when it needs only 1 or 2 agreeing neighbours instead of 3?
- **Answer**: No. Both versions accepted nothing: 0 correct, 0 wrong, all 140 parked. The prediction made before the run holds. Source: `output/summary.json`.
- **Decision**: Fixing the neighbour count does not rescue the neighbour gate. The Experiment 12 conclusion stands: with these embeddings and about 3 examples per label, closeness does not identify the label safely.
- **How sure**: High for this data. The fair method can only match or trail the test-tuned exploratory check, which itself reached at most 3 correct with zero wrong.
- **Next step**: The operator chooses between the options in the Experiment 12 report.

## Plan (written before the run)

Experiment 12 required 3 agreeing neighbours. With about 3 examples per label, that rule could fire for only 2 of 140 cases. This run measures the fixed rule properly, with thresholds chosen by the same fair fold method.

- **Change**: the number of agreeing neighbours, k = 1 and k = 2. Everything else is Experiment 12's frozen design: cached vectors, 5 group folds, threshold grid, inner leave-one-group-out selection, acceptable-label sets and the Experiment 11 ruler.
- **Baseline**: Experiment 12, k = 3: 1 correct, 0 wrong.
- **H1**: k = 1 or k = 2 passes Tier 1: W = 0 and C ≥ 29 on the 140 pooled held-out decisions.
- **H0**: neither passes.
- **Pass when**: either cell passes Tier 1. Each cell is reported on its own.
- **Prediction, stated before the run**: both fail. Experiment 12's exploratory check tuned thresholds on the test cases, and still found at most 3 correct with zero wrong (k = 2).
- **Status rule**: post-hoc exploratory. The k values were chosen after Experiment 12's results, and its exploratory check already looked at these test cases. This run can confirm or refute that check. It cannot approve a production change.
- **Data**: the 140 test cases and 60 development cases from Experiment 12's pinned inputs. No model calls.
- **Method**: `run_eval.py` loads Experiment 12's `run_eval.py` read-only, pinned by SHA-256 `10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b`. It sets the module constant `K` per cell, because that runner takes no settings object. It never writes into Experiment 12's folder.
- **Reported, not gated**: learning curve, paired comparison with Experiment 06, parked count, and rules chosen per fold.
- **Run**: `uv run --project experiments --no-sync python experiments/14-retrieval-neighbour-gate-fewer-neighbours-2026-10-11/run_eval.py`
- **Verify**: the same command with `--verify`. It recomputes and compares with zero writes.

## Results

| Cell           | Accepted (E) | Correct (C) | Wrong (W) | Parked | Tier 1 | Folds that found a safe rule |
| -------------- | -----------: | ----------: | --------: | -----: | ------ | ---------------------------- |
| k = 3 (Exp 12) |            1 |           1 |         0 |    139 | fail   | 5 of 5                       |
| k = 2          |            0 |           0 |         0 |    140 | fail   | 3 of 5                       |
| k = 1          |            0 |           0 |         0 |    140 | fail   | 0 of 5                       |

Fewer required neighbours made the gate accept less, not more. The inner check fixes this: a rule must make zero wrong picks among the training cases. With k = 1, no threshold achieved that in any fold, so every fold accepted nothing. With k = 2, three folds found a rule that was safe on their training cases (1, 1 and 4 correct). Those rules matched no held-out case.

Source: `output/summary.json`, keys `cells.k1` and `cells.k2`. The k = 3 row comes from `../12-retrieval-neighbour-reuse-gate-2026-10-11/output/summary.json`.

Reported, not gated:

- Both cells parked all 28 of Experiment 06's wrong picks on `none_fit` cases, and kept none of its 30 correct picks.
- Learning curves are flat: mean correct stays below 3 at every gallery size. Smaller galleries made a few wrong picks (k = 2 at 50%: mean 2.7 wrong), so less data is less safe, not just less useful.

Source: `output/summary.json`, keys `paired_experiment06` and `learning_curve`.

## Limits

1. Post-hoc exploratory: the k values were chosen after Experiment 12, whose exploratory check had already looked at these test cases.
2. The runner sets Experiment 12's module constant `K` per cell, because that runner has no settings object. The tests check that `K` changes the rule, and the k = 1, 2 and 3 results differ.
3. One embedding model and about 3 examples per label; a stronger embedder or more reviewed members could change this.
