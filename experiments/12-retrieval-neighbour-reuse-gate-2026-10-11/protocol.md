# Experiment 12: neighbour check against reviewed members

- **ID**: `12-retrieval-neighbour-reuse-gate-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: FAIL (2026-10-11); see [report](report.md)
- **Operator**: Dr Muhammad Aizat Md Hawari, with a planning agent
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 01, 06, 10 and 11

## 1. Question

Can a gate that compares each observation with already-labelled observations, not with label definitions, reuse labels with zero wrong picks and at least 29 correct on the 140 test cases?

The decision: whether the neighbour check becomes the candidate mechanism for first label reuse, and what Experiment 13 must beat.

## 2. Hypothesis

- **H1 (primary)**: the neighbour gate passes Tier 1 of the Experiment 11 ruler: W = 0 and C ≥ 29 over the 140 test cases.
- **H0**: W > 0, or C < 29.
- **Decision rule**:
  - H1 holds: the neighbour gate is the candidate mechanism. Tier 2 then needs fresh labelled data. Experiment 13 tests whether Clef adds correct matches.
  - H1 fails with W = 0 and a rising learning curve (defined below): INCONCLUSIVE. The gate is safe but starved; it needs more reviewed members.
  - H1 fails with W > 0: the neighbour check alone is unsafe. Experiment 13 decides whether an agreement gate fixes it.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                                                    | Primary metric                        | Guardrail metric                                     | Fixed                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Experiment 06 picks, all accepted, vs neighbour gate on cached vectors | Tier 1: W = 0 and C ≥ 29 on 140 cases | parked count (reported, not gated, by user decision) | cached `qwen3-embedding:0.6b` vectors, Experiment 10 reference, Experiment 11 ruler and acceptable sets |

No model calls. Experiment 01 cached a 1,024-dimension vector for every case and every label definition.

## 4. Data

| Item         | Value                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Source       | Experiment 01 revision-01 corpus and cached vectors; Experiment 10 reference; Experiment 11 acceptable sets                    |
| Unit         | one observation case                                                                                                           |
| Size         | 140 test cases (67 with a label, 73 `none_fit`) scored once each; 60 development cases join every gallery                      |
| Groups       | 125 test groups; cases in one group share a source and never split across folds                                                |
| Labels       | Test: Experiment 10 reference, operator-arbitrated, with Experiment 11 acceptable sets. Development: AI-authored, not reviewed |
| Already seen | Experiments 05, 06, 09, 10 and 11 used the test cases. No neighbour method has been tuned on them                              |

## 5. Steps

Run every command from the repository root. Implementation and each run need approval first. Nothing needs an install, a download or a model server.

1. Run the focused tests: `uv run --project experiments --no-sync python -m pytest experiments/12-retrieval-neighbour-reuse-gate-2026-10-11/test_run_eval.py`
2. Run the gate: `uv run --project experiments --no-sync python experiments/12-retrieval-neighbour-reuse-gate-2026-10-11/run_eval.py --phase run --resume`
3. Verify read-only: `uv run --project experiments --no-sync python experiments/12-retrieval-neighbour-reuse-gate-2026-10-11/run_eval.py --phase verify`

## 6. Analysis

- **Stats level**: basic counts and rates, plus one exact interval.
- **Test for H1**: Tier 1 rule on the pooled 140 held-out decisions. No significance test.
- **Interval**: exact one-sided 95% upper bound on W/E, as in Experiment 11.
- **Gates**:

| Gate            | Pass when                                                                                                                            | Why it matters                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| G1 integrity    | every pinned hash verifies before and after; vector records match their pinned file                                                  | the result stays tied to frozen inputs |
| G2 completeness | every test case gets exactly one held-out decision: accept a label, or park                                                          | silent drops would distort every rate  |
| G3 fold hygiene | no case, and no case from the same group, is in its own gallery or its own inner selection; a test injects a leak and sees a refusal | the gate must not see its own answer   |
| G4 Tier 1       | W = 0 and C ≥ 29                                                                                                                     | the screening bar from Experiment 11   |

- **Stop rule**: stop when all five folds are scored. Stop at once on a G1 or G3 failure.
- **What each outcome means**:
  - Pass: candidate mechanism; plan the fresh labelled set for Tier 2.
  - Fail with W = 0 and a rising curve: INCONCLUSIVE; grow the reviewed set.
  - Fail with W > 0: the gate alone is unsafe; let Experiment 13 decide.

## Extra detail

### The neighbour gate, frozen

- **Vectors**: the cached Experiment 01 vectors. Similarity is cosine similarity.
- **Gallery**: labelled cases in the same section as the query. A gallery member keeps its label: an existing label or `none_fit`. Members labelled `none_fit` stay in the gallery. They block reuse when they sit closest.
- **Rule R(τ, δ)**, with k = 3:
  1. Take the 3 most similar gallery members.
  2. Accept label X only if all 3 carry X, and X is not `none_fit`.
  3. The closest member's similarity must be at least τ.
  4. The closest X member must beat the closest non-X member (including `none_fit`) by at least δ.
  5. Otherwise park the case. The gate never writes `none_fit` by itself.
- **Grid**: τ from 0.30 to 0.95 in steps of 0.05 (14 values). δ in {0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12}. That gives 98 rules.

### Nested folds, so no threshold is fitted on the case it scores

- **Outer folds**: sort the 125 test groups by the SHA-256 of the group name. Deal them round-robin into 5 folds.
- **Outer gallery for fold f**: the 60 development cases plus the test cases outside fold f.
- **Inner selection**: inside the outer gallery, query each member against the rest, leaving out its own group. Score every rule on these inner decisions. Correctness uses the development label, or the Experiment 11 acceptable set for test cases.
- **Chosen rule**: zero inner wrong accepts and the most inner correct accepts. Break ties by larger τ, then larger δ. If no rule has zero wrong and at least one correct, fold f accepts nothing.
- **Held-out decisions**: apply the chosen rule to fold f's cases against the outer gallery. Pool all 5 folds into the 140 decisions that H1 judges.

### Learning curve, preregistered

- Subsample each outer gallery to 25%, 50% and 75% of its groups, with seeds 0, 1 and 2. Run the same nested selection. The full gallery is the 100% point.
- **Rising** means mean C at 100% is at least 5 more than mean C at 50%, with W = 0 at both.
- The curve informs the INCONCLUSIVE branch only. It never turns a fail into a pass.

### Reported, not gated

- Parked count, and how many parked cases form groups of 3 or more near-identical items (cosine ≥ the fold's τ). This estimates the holding-pen load. By user decision, review load is reported, not gated.
- Paired comparison with Experiment 06: how many of its 28 wrong picks on `none_fit` cases the gate parks, and how many of its 29 correct picks the gate keeps.
- Exploratory risk-coverage table: every grid rule applied directly to the 140 cases. Labelled exploratory, because it looks at the test cases.

### Outputs that Experiment 13 will pin

`output/folds.json` (fold of each case, chosen rule per fold) and `output/predictions.json` (per test case: decision, and the 10 nearest same-section gallery members with label and similarity).

### Input pins

`R` means `../01-label-decisions-2026-10-07/output/revision-01-batch8192/`. `B` means `../06-retrieval-primary-intent-label-selection-2026-10-10/`. `A` means `../10-review-reference-adjudication-2026-10-11/`. `E` means `../11-retrieval-catalogue-consolidation-replay-2026-10-11/`.

| Input                                 | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `R/output/vectors_checkpoint.json`    | `fa993420490c14e072b3ca789a42fa26bb76ebb0e579c1f0e6ccffb91cd881c8` |
| `R/corpus/ground-truth.json`          | `8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c` |
| `R/corpus/catalogue.json`             | `3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc` |
| `A/corpus/adjudicated-reference.json` | `b920699250d46d14160bf3edab7e1d161c0bfdc284aa87aa521c9dfb1796ecbe` |
| `B/output/eval_results.json`          | `89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8` |
| `E/output/build.json`                 | `c837a2031714516bb9b3a7f40183d451eceda53f8cb241d62a964930ba7c7643` |
| `E/plan.json`                         | `29291bc7d10abc8485475bcafd96990b0e9eddd92afc65f82a23d234fdac968d` |

### Validity

- Development labels are AI-authored. They sit in every gallery.
- The test reference is operator-arbitrated.
- The 140 cases were used before, but no neighbour threshold is fitted on a case it scores.
- Tier 1 is screening only. Production evidence needs Tier 2 on fresh data.

### Privacy and cloud

No hosted calls and no model calls. The runner reads frozen local JSON only and logs counts, identifiers and hashes.

### Scripts

`run_eval.py` with phases `run` and `verify`. `analysis.py` after results. Tests are outside the three-script limit.

### Amendments

None at planning. Planned at commit `fb699eb7c85ee30a12218e5b375f54ba78c5592c`.
