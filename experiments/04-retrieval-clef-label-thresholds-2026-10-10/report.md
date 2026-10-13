# Experiment 04: Clef label acceptance thresholds

- **Alias**: Experiment 1a
- **ID**: `04-retrieval-clef-label-thresholds-2026-10-10`
- **Category**: retrieval
- **Size**: Quick
- **Status**: INCONCLUSIVE (exploratory gates FAIL)
- **Operator**: Dr Muhammad Aizat Md Hawari, with a planning agent

## Answer

- **Question**: Can acceptance-threshold calibration reduce Clef's wrong existing-label reuse while retaining useful correct matches?
- **Answer**: No listed threshold meets both approved gates on these saved results.
- **Decision**: Nominate no threshold for production or independent evaluation from this grid.
- **How sure**: Low for generalisation. The inspected AI reference labels have no independent human review.
- **Next step**: Review the remaining label errors before proposing a fresh, independently reviewed evaluation.

Source: `output/summary.json`, all grid rows and `selected_threshold`.

## Approval record

On 2026-10-10, the user selected **Approve and run** for implementation and saved-results rescoring.
The approval included C >= 19 and wrong existing-label reuse strictly below 2%.
The original plan below remains unchanged. Its approval-pending wording records the pre-run state.

## Plan (written before the run)

### Scope and hypotheses

This follow-up rescoring uses saved Experiment 01 Clef answers and probabilities.

The baseline accepts every answer at threshold 0.
The change accepts an answer only when its saved score meets the threshold.
Rejected answers become `REVIEW`, meaning a person must decide.

- **H1**: A grid threshold meets the wrong-reuse limit while retaining the proposed useful coverage.
- **H0**: No grid threshold meets both requirements.
- **Decision supported**: Choose an exploratory threshold for later independent evaluation.
- **Statistics**: Basic counts, rates and paired routing differences. No p-values or confidence intervals.

The saved test results have already been fully inspected.
Threshold selection on these results is post-hoc exploratory work.
The original test split provides no fresh held-out validation here.

No new corpus, inference, training, prompt changes, model changes, DeepSeek calls or server restarts are permitted.
Production promotion remains outside scope.

### Fixed inputs

`R` means:

`experiments/01-label-decisions-2026-10-07/output/revision-01-batch8192`

Source commit: `d22b578`.

| Input relative to R                   | Byte SHA-256                                                       |
| ------------------------------------- | ------------------------------------------------------------------ |
| `output/eval_results.json`            | `39ce9b53cf63ccaba9e93fad6355571de704a60a46e800ef4d417115baa35ebe` |
| `corpus/ground-truth.json`            | `8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c` |
| `corpus/test-manifest.json`           | `9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd` |
| `corpus/ai-reference-provenance.json` | `acf37b8e8f460433e956b301d5363e2609d9dc627aec03189a9a816d43584f80` |
| `preserved-files.json`                | `602d6bba39b07c2fc67f63d30227d688c6bd7b441a22f50f0dafbcbeae795649` |

The canonical manifest digest is:

`2c36194f63fd87cd9147701ac6b93c027bc59ff8b96d4a011aefa65ceb61cb44`

Canonical JSON uses `sort_keys=True`, `separators=(',', ':')` and `allow_nan=False`.
This digest differs from the file's byte hash.
It must match `test_manifest_sha256` in the saved results.

Verify every preservation hash before and after rescoring.
Keep all original inputs, results and shared helpers unchanged.

### Selection and score

Read the values of the saved results object's `records` field.

Select only records matching:

- `arm == "L3-clef"`
- `split == "test"`
- `order == 0`

Join each `case_id` to the reference `id`.
Require exactly 140 unique successful records with complete reference matches.
Require 54 positive references and 86 references containing only `none_fit`.
Reject missing or duplicate selected cases and reference IDs.
Require selected IDs to match the pinned test manifest.

A positive reference names an existing label.
An explicit `none_fit` answer means the model chose no existing label.

Require `score_kind == "native_choice_probability"`.
Require `score == probabilities[answer]`.
Validate finite probabilities, their range and the complete choice distribution.

`provider_confidence` is a different field and must never replace `score`.
Choice probabilities have no established empirical calibration.

Evidence: [Experiment 01 run_eval.py](../01-label-decisions-2026-10-07/run_eval.py), lines 27–37, defines the saved score.

### Thresholds and routing

Use the fixed grid from [Experiment 01 labels.py](../01-label-decisions-2026-10-07/labels.py), line 16:

`[0, 0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 1]`

Accept when `score >= threshold`.
Apply this rule to existing-label answers and explicit `none_fit` answers.

Below-threshold answers become `REVIEW`.
Review abstention never counts as a correct label or correct `none_fit`.

Keep the original answer and raw correctness unchanged.
Report every grid row, including thresholds with no accepted answers.

### Metrics

| Symbol | Meaning                                      |
| ------ | -------------------------------------------- |
| N      | All 140 selected cases                       |
| A      | All accepted answers                         |
| E      | Accepted existing-label answers              |
| W      | Wrong accepted existing-label answers        |
| C      | Correct accepted existing-label answers      |
| F      | Correct accepted explicit `none_fit` answers |
| B      | Cases routed to review                       |

Report the accepted explicit `none_fit` count separately from F.
Require `A + B == N` and `E == C + W`.

| Metric                            | Formula |
| --------------------------------- | ------- |
| Wrong existing-label reuse rate   | W/E     |
| Accepted precision                | (C+F)/A |
| Automatic coverage                | A/N     |
| Existing-label coverage           | E/N     |
| Retained correct positive matches | C/38    |
| Positive-reference coverage       | C/54    |
| Review load                       | B/N     |
| Correct automatic yield           | (C+F)/N |

Store rates with zero denominators as `null`.
Raw answer accuracy remains 68/140 at every threshold.

Report changes against threshold 0.
Show avoided wrong existing-label reuse and lost correct decisions as separate routing effects.
Raw prediction wins and losses are both zero because predictions remain fixed.

### Decision rule

A threshold qualifies only when all these gates pass:

1. Every input, preservation, manifest, selection and score check passes.
2. E is greater than zero.
3. W/E is strictly below 0.02, using unrounded values.
4. C is at least 19.

The fourth gate is a proposed requirement awaiting explicit user approval.
It retains half the baseline's 38 correct existing-label matches.
This choice expresses desired useful coverage; the evidence does not establish it as sufficient.

Select the smallest grid threshold passing every gate.
If none qualifies, report that none meets the proposed trade-off.
Empty acceptance and rejecting every existing-label answer cannot pass.

Gate outcomes describe this exploratory sample only.
Final validity remains `INCONCLUSIVE` because `human_reviewed` is false.

### Approved implementation shape

Implementation requires separate approval.

Allow at most one Python script, `rescore.py`; tests do not count towards this limit.
Use the existing Python environment and standard library.
Make no network calls and import no model runners.
Do not add shared statistics scaffolding; the absent `experiments/_lib/` requires no setup for basic counts.

Save:

- `output/rescored.json`: per-case routing and correctness for every threshold.
- `output/summary.json`: counts, rates, baseline differences, gate outcomes and threshold selection.

Both outputs record source hashes, fixed settings and `human_reviewed: false`.
Write outputs atomically through temporary files followed by rename.
Checkpoint after each threshold.
`--resume` must reject changed inputs or settings.
`--verify` must reproduce saved outputs through read-only checks without model calls.

Tests must cover inclusive thresholds, the strict 2% boundary, zero acceptance and `none_fit` versus review.
Also cover the 19-match guard, score versus confidence, missing records, duplicates, hash drift, resume and verification.
Demonstrate that tests fail when their corresponding checks are broken.

### Planned commands

These commands are documented only. None has run.

Run from the verified repository root after approval:

```bash
D=experiments/04-retrieval-clef-label-thresholds-2026-10-10
python3 -m unittest discover -s "$D" -p 'test_*.py'
python3 -u "$D/rescore.py" --resume
python3 "$D/rescore.py" --verify
```

## Saved baseline evidence

These numbers describe existing Experiment 01 outputs.
They are not new Experiment 1a results.

Sources:

- `R/output/eval_results.summary.json`, arm `L3-clef`
- `R/comparison.json`, diagnostics for `L3-clef`
- `R/output/eval_results.json`, selected raw records
- `R/corpus/ground-truth.json`, reference composition

| Baseline quantity                   |  Value |
| ----------------------------------- | -----: |
| Accepted answers                    |    140 |
| Accepted existing labels            |    107 |
| Wrong accepted existing labels      |     69 |
| Correct existing-label matches      |     38 |
| Correct explicit `none_fit` answers |     30 |
| Raw correct answers                 |     68 |
| Raw accuracy                        | 68/140 |
| Wrong existing-label reuse rate     | 69/107 |

Wrong existing-label reuse comprises 56 reuse answers on `none_fit` references and 13 wrong labels on positive references.
Three positive references received wrong explicit `none_fit` answers.
Source: `R/comparison.json`.

The source corpus has 200 cases and 41 catalogue labels.
Its development split has 60 positive cases and no `none_fit` cases.
Sources: `R/corpus/test-manifest.json` and its pinned corpus evidence, including `R/corpus/ground-truth.json`.

## Results

All eight thresholds completed. No threshold qualifies.
Exploratory gates **FAIL**; final validity remains **INCONCLUSIVE**.

Sources for every table and result below: `output/summary.json` and the per-case rows in `output/rescored.json`.

### Counts

N is 140 in every row. Raw correct answers remain 68 at every threshold.
Review cases receive no automatic answer and never count as correct `none_fit`.

| Threshold | A accepted | E existing | W wrong existing | C correct existing | Accepted none_fit | F correct none_fit | B review |
| --------- | ---------: | ---------: | ---------------: | -----------------: | ----------------: | -----------------: | -------: |
| 0         |        140 |        107 |               69 |                 38 |                33 |                 30 |        0 |
| 0.5       |         90 |         76 |               41 |                 35 |                14 |                 12 |       50 |
| 0.65      |         62 |         52 |               22 |                 30 |                10 |                  9 |       78 |
| 0.8       |         26 |         25 |                4 |                 21 |                 1 |                  1 |      114 |
| 0.9       |         16 |         16 |                1 |                 15 |                 0 |                  0 |      124 |
| 0.95      |          3 |          3 |                0 |                  3 |                 0 |                  0 |      137 |
| 0.99      |          0 |          0 |                0 |                  0 |                 0 |                  0 |      140 |
| 1         |          0 |          0 |                0 |                  0 |                 0 |                  0 |      140 |

Higher thresholds remove wrong answers and correct answers from automatic decisions.

### Rates

All displayed rates are percentages rounded to two decimal places. Gate comparisons use unrounded values.
Undefined rates are shown as `undefined` and stored as `null`.

| Threshold | Wrong reuse W/E | Accepted precision | Automatic coverage | Existing coverage | Retained C/38 | Positive coverage C/54 | Review load | Correct automatic yield |
| --------- | --------------: | -----------------: | -----------------: | ----------------: | ------------: | ---------------------: | ----------: | ----------------------: |
| 0         |           64.49 |              48.57 |             100.00 |             76.43 |        100.00 |                  70.37 |        0.00 |                   48.57 |
| 0.5       |           53.95 |              52.22 |              64.29 |             54.29 |         92.11 |                  64.81 |       35.71 |                   33.57 |
| 0.65      |           42.31 |              62.90 |              44.29 |             37.14 |         78.95 |                  55.56 |       55.71 |                   27.86 |
| 0.8       |           16.00 |              84.62 |              18.57 |             17.86 |         55.26 |                  38.89 |       81.43 |                   15.71 |
| 0.9       |            6.25 |              93.75 |              11.43 |             11.43 |         39.47 |                  27.78 |       88.57 |                   10.71 |
| 0.95      |            0.00 |             100.00 |               2.14 |              2.14 |          7.89 |                   5.56 |       97.86 |                    2.14 |
| 0.99      |       undefined |          undefined |               0.00 |              0.00 |          0.00 |                   0.00 |      100.00 |                    0.00 |
| 1         |       undefined |          undefined |               0.00 |              0.00 |          0.00 |                   0.00 |      100.00 |                    0.00 |

Raw accuracy stays 48.57% for every threshold. Improved accepted precision does not improve the original predictions.

### Gates and paired routing effects

Every threshold passes the fixed-input integrity checks.
Avoided reuse counts wrong existing-label answers sent to review.
Lost correct decisions include both correct existing labels and correct explicit `none_fit` answers sent to review.

| Threshold | E > 0 | W/E < 2% | C >= 19 | Qualifies | Avoided wrong reuse | Lost correct decisions |
| --------- | ----- | -------- | ------- | --------- | ------------------: | ---------------------: |
| 0         | PASS  | FAIL     | PASS    | No        |                   0 |                      0 |
| 0.5       | PASS  | FAIL     | PASS    | No        |                  28 |                     21 |
| 0.65      | PASS  | FAIL     | PASS    | No        |                  47 |                     29 |
| 0.8       | PASS  | FAIL     | PASS    | No        |                  65 |                     46 |
| 0.9       | PASS  | FAIL     | FAIL    | No        |                  68 |                     53 |
| 0.95      | PASS  | PASS     | FAIL    | No        |                  69 |                     65 |
| 0.99      | FAIL  | FAIL     | FAIL    | No        |                  69 |                     68 |
| 1         | FAIL  | FAIL     | FAIL    | No        |                  69 |                     68 |

Raw prediction wins and losses remain zero. All 140 predictions tie against the baseline because their answers stay unchanged.

### Interpretation

At 0.8, wrong reuse drops from 64.49% to 16.00%, a reduction of 48.49 percentage points.
This threshold retains 21 correct existing-label matches, exceeding the approved minimum of 19.
Its wrong-reuse rate exceeds the approved limit, and 114 cases require review.

At 0.95, all three accepted answers are correct existing labels.
Only three of the baseline's 38 correct existing-label matches remain automatic, and 137 cases require review.
This threshold fails useful coverage. The empty accepted sets at 0.99 and 1 also fail.

No grid threshold provides the approved trade-off. These findings describe the saved, previously inspected AI-labelled sample.

### Execution and verification

The documented test, resume and verification commands ran successfully.
The focused suite has 14 passing tests. Each test detected a deliberate fault in a disposable scorer copy.
Proof: `output/test-proof.json`.

The run checkpointed all eight thresholds and verified saved counts, rates, routing and gate outcomes without writing during verification.
All 97 original preservation hashes match. The run made zero inference calls.
Source: `output/summary.json`, metadata and `inference_calls`.

No installation, server restart, model change or production change occurred.

## Limits

1. Threshold selection uses previously inspected results and cannot establish fresh held-out performance.
2. AI-only reference labels leave final validity `INCONCLUSIVE`, regardless of exploratory gate outcomes.
3. Native choice probabilities have no established empirical calibration.
4. The proposed useful-coverage guard requires explicit approval before implementation or rescoring.
5. This experiment cannot approve a production threshold or behaviour change.
