# Experiment 09: verification gate before first label reuse

- **ID**: `09-retrieval-verify-label-reuse-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: INCONCLUSIVE (AI reference); functional FAIL — both arms failed calibration (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an implementation agent after approval
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 03, 04, 05 and 06

## Answer

- **Question**: Can a calibrated binary verification gate on the classifier's chosen label bring wrong reuse below 2% while retaining at least 19 correct matches?
- **Answer**: No arm qualified. Both verifiers failed the frozen calibration rule on the development split, so neither ran on the test cases. Source: `output/calibration.json`.
- **Decision**: Stop. Verification gates of this class do not fix first-assignment reuse on this evidence. Do not propose another prompt or model change from these results.
- **How sure**: Functional FAIL at calibration, before any test inference. Validity stays INCONCLUSIVE because the reference labels are AI-authored and previously inspected.
- **Next step**: None under the decision rule. Any further verifier work needs a new, separately approved experiment.

## What ran

All commands came from the repository root with the approved installs (`onnxruntime` 1.31.0, `tokenizers` 0.23.3; recorded in `output/run-manifest.json`).

1. Focused tests: 10 passed, and 11 deliberate faults in disposable copies were all detected. Source: `output/test-proof.json`.
2. Approved download: `model_qint8_arm64.onnx`, 172,503,006 bytes, SHA-256 `a1da6815…8714e6e` (pin matched); `tokenizer.json`, 8,656,624 bytes, SHA-256 `5124ef2e…3707964` (recorded at download).
3. NLI calibration: 1230 development pairs, offline CPU, no hosted calls.
4. Clef calibration: 1230 development pairs through the experiment-owned server on `127.0.0.1:3004`. The Experiment 03 llama.cpp build and Clef-Flash-Q8_0 weights were re-verified against the recorded pins before launch; the port was free; only the owned child was started and stopped.
5. Test phase: refused for both arms (`calibration_failed_test_refused`). The 71 existing-label picks were never re-asked and never verified. The proposer made no calls. The 69 `none_fit` answers stayed untouched.
6. Read-only verification reproduced the calibration, summary and freeze-order checks with zero inference, writes or server calls.

## Results

### Calibration (development split, 60 positive and 1170 negative pairs)

Source for both tables: `output/calibration.json`. Wrong rate means wrong accepts divided by all accepted pairs at that threshold. A threshold qualifies only when the wrong rate is at most 2% and at least 45 of 60 positives are retained.

NLI arm (`cross-encoder/nli-deberta-v3-small`, official int8 ARM64 ONNX):

| tau  | Accepted | Positives kept | Wrong accepts | Wrong rate | Qualifies |
| ---- | -------- | -------------- | ------------- | ---------- | --------- |
| 0.50 | 69       | 25             | 44            | 63.77%     | no        |
| 0.60 | 60       | 24             | 36            | 60.00%     | no        |
| 0.70 | 53       | 20             | 33            | 62.26%     | no        |
| 0.75 | 47       | 19             | 28            | 59.57%     | no        |
| 0.80 | 44       | 18             | 26            | 59.09%     | no        |
| 0.90 | 31       | 15             | 16            | 51.61%     | no        |
| 0.95 | 26       | 13             | 13            | 50.00%     | no        |

The NLI model rarely calls these pairs entailment: only 25 of 60 positives had entailment as the argmax at all, while 44 same-section negatives also did. Median P(entailment) on positives was 0.0758. Source: `output/eval_results.json`.

Clef arm (Experiment 03-pinned Clef-Flash-Q8_0, native yes/no choice probabilities):

| tau  | Accepted | Positives kept | Wrong accepts | Wrong rate | Qualifies                  |
| ---- | -------- | -------------- | ------------- | ---------- | -------------------------- |
| 0.50 | 262      | 60             | 202           | 77.10%     | no                         |
| 0.60 | 175      | 56             | 119           | 68.00%     | no                         |
| 0.70 | 106      | 45             | 61            | 57.55%     | no                         |
| 0.75 | 75       | 39             | 36            | 48.00%     | no                         |
| 0.80 | 40       | 25             | 15            | 37.50%     | no                         |
| 0.90 | 3        | 3              | 0             | 0.00%      | no (3 positives, below 45) |
| 0.95 | 0        | 0              | 0             | undefined  | no (empty acceptance)      |

Clef separated the pairs far better than NLI, but the two constraints never intersect on the frozen grid. Reaching a wrong rate at or below 2% required tau 0.9, where only 3 of 60 positives survived. Holding 45 positives required tau 0.7, where 61 negatives were also accepted.

### Gate outcome

- **G1 integrity**: pass. All pinned input hashes verified before and after each phase; every `preserved-files.json` entry stayed unchanged; no threshold was frozen because none qualified, and no test inference occurred. Source: `output/run-manifest.json`.
- **G2 to G5**: not evaluated. Both arms stopped at calibration under the frozen rule, so there are no accepted reuses, routed reviews, errors, retained matches or review-load figures to report. Blocked-wrong, lost-correct, review load and the wrong-reuse upper bound are undefined for this run.
- **Overall functional**: FAIL (no arm passed). Validity: INCONCLUSIVE. Source: `output/summary.json`.

### Baseline (unchanged, from Experiment 06 saved answers)

| Metric               | Saved Experiment 06 |
| -------------------- | ------------------- |
| Cases                | 140                 |
| Existing-label picks | 71                  |
| Correct picks        | 23                  |
| Wrong picks          | 48                  |
| Wrong reuse (W/E)    | 67.61%              |
| `none_fit` answers   | 69 (49 correct)     |

Source: `output/summary.json`, key `baseline`, recomputed from the pinned Experiment 06 `output/eval_results.json`.

## Integrity and reproduction

- `--phase verify` reproduced the calibration selection, summary and event ordering with zero inference, writes or server calls, over all 2460 scored records.
- Both calibration phases were re-run after the runner fix recorded in `plan.json` amendment 2. The re-run was deterministic: 2460 records compared, 0 score mismatches against the first attempt. The first attempt's files are preserved under `output/attempt-1-calibration-only/`.
- Experiments 01 to 08 stayed read-only; the runner wrote only inside this folder.
- No prompts or raw model replies were logged. Records hold probabilities, labels, token counts, durations and error codes only.

## Amendments

Both are recorded in `plan.json` before the affected work.

1. Negative calibration pairs corrected from 1470 to 1170. The pinned catalogue holds 41 labels (22 preferences, 19 patterns), not the 51 the protocol assumed. The construction rule and every gate are unchanged.
2. The runner now writes `output/summary.json` at the end of the calibrate phase as well, so a calibration-failed state still produces a verifiable summary. Both calibrations were re-run from empty checkpoints because the manifest binds the runner SHA-256.

## Limits

- Development negatives are same-section definitions, not the proposer's near-neighbour wrong picks. This accepted risk never reached the test gates: calibration failed on development first.
- The NLI arm used the official int8 ARM64 ONNX build. Quantisation can shift scores slightly; the threshold would have been calibrated on the same artefact, so the arm stays internally consistent.
- Clef yes/no probabilities come from native scoring without token generation, so temperature and seed do not apply.
- The reference labels are AI-authored and previously inspected, so validity stays INCONCLUSIVE regardless of the functional outcome.

## Cleanup

The ONNX model stays in the ignored `output/model/` folder for verification. Delete it only after the user accepts this report.
