# Experiment 11: catalogue consolidation replay and the new scoring ruler

- **ID**: `11-retrieval-catalogue-consolidation-replay-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: FAIL (2026-10-11); see [report](report.md)
- **Operator**: Dr Muhammad Aizat Md Hawari, with a planning agent
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 06, 09 and 10

## 1. Question

How much of Experiment 06's wrong label reuse disappears when confusable labels merge into a smaller catalogue built from development evidence only?

The decision: which catalogue (41 labels or a merged version) and which scoring ruler Experiments 12 (neighbour check) and 13 (compare check) use.

## 2. Hypothesis

- **H1 (primary)**: at the 20-label merge level (L20), at least half of the label-versus-label wrong picks become correct.
- **H0**: fewer than half become correct.
- **Decision rule**: if H1 holds and guardrail G5 holds, the L20 merge map becomes the draft catalogue for Experiments 12 and 13. Merged definitions are rewritten in a separate step. Otherwise keep 41 labels for Experiment 12 and look for consolidation evidence other than definition confusion.

Known ceiling, stated before the run. In the Experiment 10 re-score, 28 of the 42 wrong picks fall on cases whose reference is `none_fit`. Merging labels cannot change those 28. The best possible wrong reuse is therefore 28 of 71 (39.4%). Picking a label when none fits is the main problem. Experiments 12 and 13 target it.

This experiment re-scores answers that earlier work already inspected. By `../AGENTS.md`, it is post-hoc exploratory work. It can choose inputs for later experiments. It cannot approve a production change.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                                     | Primary metric                                                     | Guardrail metric                                                            | Fixed                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 41-label catalogue vs dev-built merge maps (30, 20, 12) | share of label-versus-label wrong picks that become correct at L20 | largest merged label's share of its section's reference-positive test cases | Experiment 06 saved answers, Experiment 10 reference, acceptable-label sets |

No model calls. The runner maps the saved picks and the reference labels through each merge map, then scores them again.

## 4. Data

| Item         | Value                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | Experiment 06 saved answers; Experiment 10 frozen reference; Experiment 09 Clef calibration scores; Experiment 01 revision-01 corpus           |
| Unit         | one observation case                                                                                                                           |
| Size         | 140 test cases (67 reference positives, 73 `none_fit`); 60 development cases build the merge maps                                              |
| Groups       | 41 labels: 22 preferences, 19 patterns; every label has 1 to 4 development cases                                                               |
| Labels       | Test: Experiment 10 reference, operator-arbitrated. Development: AI-authored (a-writer, 2026-10-07), not human reviewed                        |
| Already seen | Experiments 05, 06, 09 and 10 used the test cases. Experiment 09 scored every development pair with Clef. Experiment 06 answers were inspected |

## 5. Steps

Run every command from the repository root. Implementation and each run need approval first. Nothing needs an install, a download or a model server.

1. Run the focused tests: `uv run --project experiments --no-sync python -m pytest experiments/11-retrieval-catalogue-consolidation-replay-2026-10-11/test_run_eval.py`
2. Build the merge maps and acceptable-label sets: `uv run --project experiments --no-sync python experiments/11-retrieval-catalogue-consolidation-replay-2026-10-11/run_eval.py --phase build`
3. Score every cell: `uv run --project experiments --no-sync python experiments/11-retrieval-catalogue-consolidation-replay-2026-10-11/run_eval.py --phase score --resume`
4. Verify read-only: `uv run --project experiments --no-sync python experiments/11-retrieval-catalogue-consolidation-replay-2026-10-11/run_eval.py --phase verify`

## 6. Analysis

- **Stats level**: basic counts and rates, plus one exact interval.
- **Test for H1**: count comparison at L20. No significance test.
- **Interval**: exact one-sided 95% binomial upper bound on wrong reuse (W/E) in each cell, computed by standard-library summation.
- **Gates**:

| Gate               | Pass when                                                                                                         | Why it matters                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| G1 integrity       | every pinned hash verifies before and after; build outputs are hashed into the manifest before scoring            | the comparison stays tied to frozen inputs            |
| G2 completeness    | all 140 cases carry one scored outcome in every cell                                                              | silent drops would distort every rate                 |
| G3 reproduction    | cell C0 gives E 71, C 29, W 42, matching the Experiment 10 summary                                                | proves the scorer matches the earlier ruler           |
| G4 build blindness | the build phase reads development records and the catalogue only; a test injects a test record and sees a refusal | merge maps must not learn from the test cases         |
| G5 guardrail       | at L20, no merged label holds more than 30% of its section's reference-positive test cases                        | a catch-all label would "fix" confusion by erasing it |

- **Stop rule**: stop when all five cells are scored. Stop at once on a G1, G3 or G4 failure.
- **What each outcome means**:
  - Pass (H1 and G5): use the L20 map as the draft catalogue for Experiments 12 and 13.
  - Fail: keep 41 labels for Experiment 12. Report which label pairs stayed confused.
  - Unclear (G5 fails while H1 holds): report INCONCLUSIVE. Do not retune targets. Choose the catalogue for Experiment 12 by a recorded user decision.

## Extra detail

### The scoring ruler, frozen for Experiments 11 onwards

The flat 2% gate is retired. The 140-case set cannot show 2%: with zero wrong picks, it needs 149 accepted picks.

- **Correct pick**: the chosen label lies in the case's acceptable-label set. `none_fit` answers and review routing never count as reuse.
- **Wrong reuse**: W/E among accepted reuse picks, with its exact one-sided 95% upper bound U.
- **Tier 1, screening on the 140-case set**: W = 0 and C ≥ 29. That proves U ≤ 9.8%. It replaces the old C ≥ 19 floor.
- **Tier 2, production evidence**: U ≤ 5% on a fresh labelled set never used for design or tuning. That needs E ≥ 59 with W = 0, or E ≥ 93 with W ≤ 1.
- **2%**: a long-run aim, checked as data accumulates. It is no longer a gate.

Experiment 11 reports Tier 1 for every cell for reference. The baseline classifier fails it by design. Tier 1 is not this experiment's question.

### Acceptable-label sets

Built from the Experiment 10 corpus, before scoring:

- Start each test case with the set {reference label}.
- Read `agent-draft-response.json`. Take cases whose drafter position is `keep` or `other`. These are the disputes left after reconsideration.
- Widen a set only when the drafter's label and the judge's label are both existing catalogue labels and differ. Add both.
- `none_fit` and `uncertain` never widen a set. A case whose reference is `none_fit` keeps the set {`none_fit`}.

Known before the run: 9 of the 10 remaining disputes set a label against `none_fit` or `uncertain`. At most 1 case widens. Cell C1 therefore differs from C0 by at most one case. It still runs, because Experiments 12 and 13 use the rule.

### Merge-map construction, frozen

- Input: Experiment 09 Clef calibration records (`phase` `calibration`, `arm` `clef`). Each record holds `p_yes` for one development case against one same-section definition. 60 positive and 1,170 negative pairs.
- Similarity of labels L and M in one section: the mean `p_yes` over development cases of L scored against M's definition, and development cases of M scored against L's definition.
- Clustering: average linkage within each section. Merge the most similar pair of clusters, one pair at a time. Break ties by the lexically smallest pair of sorted member-id lists.
- Targets, proportional to 22 preferences and 19 patterns:

| Level | Preferences | Patterns | Total |
| ----- | ----------- | -------- | ----- |
| L30   | 16          | 14       | 30    |
| L20   | 11          | 9        | 20    |
| L12   | 6           | 6        | 12    |

- Merged label id: the sorted member ids joined by `+`. This experiment does not rewrite definitions.
- The NLI arm is not used. Experiment 09 showed it reads most matching pairs as neutral.

### Cells

All cells use the same 140 Experiment 06 answers (a paired design).

| Cell | Catalogue | Scoring                |
| ---- | --------- | ---------------------- |
| C0   | 41 labels | single reference label |
| C1   | 41 labels | acceptable-label set   |
| C2   | L30       | acceptable-label set   |
| C3   | L20       | acceptable-label set   |
| C4   | L12       | acceptable-label set   |

Per cell, report: label count, E, C, W, W/E, U, wrong picks split by reference `none_fit` and by reference label, Tier 1 result, and the largest merged label's share (G5).

Primary count for H1: N is the label-versus-label wrong picks in C1. H1 holds when at least ceil(N / 2) of them are correct in C3.

### Exploratory, labelled as such

- Dispute concordance: for each Experiment 10 dispute with two existing labels, report whether both labels share a merged label at L20.
- The confused label pairs that remain at each level.

### Input pins

`R` means `../01-label-decisions-2026-10-07/output/revision-01-batch8192/`. `B` means `../06-retrieval-primary-intent-label-selection-2026-10-10/`. `V` means `../09-retrieval-verify-label-reuse-2026-10-11/`. `A` means `../10-review-reference-adjudication-2026-10-11/`.

| Input                                 | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `B/output/eval_results.json`          | `89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8` |
| `R/corpus/ground-truth.json`          | `8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c` |
| `R/corpus/catalogue.json`             | `3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc` |
| `V/output/eval_results.json`          | `ae2624f90289c3ad9d1b0bf12d29f5fe87f9a1a74919fbe747251d3b7ed780fb` |
| `V/output/calibration.json`           | `26eecd08d8513f03ce7030def787c829063887d9cb1ba67d1bf19bd1a29d05f9` |
| `A/corpus/adjudicated-reference.json` | `b920699250d46d14160bf3edab7e1d161c0bfdc284aa87aa521c9dfb1796ecbe` |
| `A/corpus/agent-draft-decisions.json` | `f100795172d4ef27a32005eec2d095adc3cc4ebd12de66a7b407d1335a12460a` |
| `A/corpus/agent-judge-verdicts.json`  | `1c81bf1f23c2ff2fde17e79a64d416dbce84807871d13a69f45e9992341cdb53` |
| `A/corpus/agent-draft-response.json`  | `9a54e6d1c5fd30500b03df34590178e00e738d6bc14753f9016d89db9d040610` |
| `A/output/summary.json`               | `c0075ee85066cbbc8b3bb65450806b57636d5bfd74b89355fe449abf9da6cbe9` |

### Validity

- Merge maps inherit the AI-authored development labels and Clef's view of the definitions.
- The test reference is operator-arbitrated, not blind solo human review.
- A replay assumes the classifier would pick the same original label on a merged catalogue. A real re-run can differ. Treat the merged results as an upper estimate.
- Post-hoc exploratory status applies to every result. Validity is INCONCLUSIVE for production purposes.

### Privacy and cloud

No hosted calls and no model calls. The runner reads frozen local JSON only. It logs counts, identifiers and hashes, never observation text.

### Scripts

`run_eval.py` with phases `build`, `score` and `verify`. `analysis.py` after results exist. Tests are outside the three-script limit.

### Amendments

Planned at commit `fb699eb7c85ee30a12218e5b375f54ba78c5592c`. The original plan text above is unchanged.

1. 2026-10-11, before any results. G4 applies to merge-map construction only: it reads development records and the catalogue, and refuses an injected test record. The acceptable-label sets read the Experiment 10 reference and dispute files. Neither part reads Experiment 06 answers; only the score phase does. Reason: the build phase writes both outputs, and G4 as written forbade the second.
