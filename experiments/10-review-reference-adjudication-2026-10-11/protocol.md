# Experiment 10: blind human adjudication of the reference labels

- **ID**: `10-review-reference-adjudication-2026-10-11`
- **Category**: review
- **Size**: Standard
- **Status**: PLANNED
- **Operator**: Dr Muhammad Aizat Md Hawari (adjudicator), with an implementation agent
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 01, 05, 06 and 09

## 1. Question

How often do the AI-authored reference labels for the 140 test cases disagree with blind human adjudication, and does the Experiment 06 classifier verdict change when re-scored against the human reference?

The decision: the adjudicated file becomes the trusted reference for catalogue consolidation (the follow-up experiment) and for any future model evaluation.

## 2. Hypothesis

- **H1 (primary)**: the human and AI references disagree on a material share of cases (at least 10 of 140).
- **H0**: they disagree on fewer than 10 cases, and the AI reference already stands as ground truth.
- **Decision rule**: either way, the adjudicated file is frozen as the reference. The disagreement rate and the re-scored classifier metrics decide whether the Experiment 05, 06 and 09 conclusions need revisiting, and feed the catalogue consolidation experiment.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                                       | Primary metric                             | Guardrail metric                | Fixed                                                       |
| --------------------------------------------------------- | ------------------------------------------ | ------------------------------- | ----------------------------------------------------------- |
| reference source: AI-authored vs blind human adjudication | disagreement count and rate over 140 cases | share of cases left `uncertain` | corpus, catalogue, saved Experiment 06 answers, page layout |

## 4. Data

| Item         | Value                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | Experiment 01 revision-01 corpus; Experiment 06 saved answers for the re-score                                                                                       |
| Unit         | one test case                                                                                                                                                        |
| Size         | 140 test cases                                                                                                                                                       |
| Groups       | 51-section catalogue claims corrected: 41 labels in two sections (22 preferences, 19 patterns); three omitted-candidate and three boundary cases reported separately |
| Labels       | adjudicated blind by the operator on 2026-10-11 or later; no AI assistance during adjudication                                                                       |
| Already seen | Experiments 01, 04, 05, 06 and 09 used the test cases; the operator has seen experiment reports but not per-case expected labels during adjudication                 |

## 5. Steps

Run every command from the repository root.

1. Build the page: `uv run --project experiments --no-sync python experiments/10-review-reference-adjudication-2026-10-11/build_page.py`
2. Adjudicate: open `output/adjudication.html` in a browser, decide every case blind, download the JSON, save it as `experiments/10-review-reference-adjudication-2026-10-11/corpus/adjudication-decisions.json`
3. Finalise: `uv run --project experiments --no-sync python experiments/10-review-reference-adjudication-2026-10-11/finalise_reference.py --resume`
4. Verify read-only: `uv run --project experiments --no-sync python experiments/10-review-reference-adjudication-2026-10-11/finalise_reference.py --verify`

## 6. Analysis

- **Stats level**: basic counts and rates.
- **Test for H1**: none; the disagreement count is the result.
- **Interval**: none.
- **Gates**:

| Gate            | Pass when                                                                                                | Why it matters                                         |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| G1 integrity    | all pinned input hashes verified; the decisions file covers exactly the 140 case IDs with valid choices  | the reference stays tied to the frozen inputs          |
| G2 blindness    | the page embeds no expected, reference or classifier field; tests detect a leaked field in a faulty copy | a leaked answer would bias the adjudication            |
| G3 completeness | every case has exactly one outcome: a same-section label ID, `none_fit`, or `uncertain`                  | silent drops or double answers would corrupt the ruler |

- **Stop rule**: stop when the reference is frozen and the summary is written. Incomplete adjudication stops before freezing; the page keeps progress, so the operator can continue later.
- **What each outcome means**:
  - Agreement high (H0): keep the AI reference as a proxy; consolidation proceeds on the human file anyway.
  - Agreement low (H1): re-state the Experiment 05, 06 and 09 conclusions against the human reference before any production proposal.
  - Many `uncertain` cases: the catalogue is genuinely ambiguous; consolidation gains priority.

## Extra detail

### Adjudication options

Each case offers every label in the case's own section (all 22 or all 19, not just the classifier's 17 candidates), plus `none_fit` and `uncertain`. Definitions and aliases are shown with each option. `uncertain` stays in the frozen reference and is reported separately; the re-score excludes it from rates.

### Re-score

The frozen summary re-scores the saved Experiment 06 answers against the human reference: existing picks (E), correct (C), wrong (W), W/E, and whether the wrong-reuse gate (W/E below 2%) would pass. Cases the human marked `uncertain` are counted, not rated. The saved answers are read from the pinned file; no model calls happen.

### Privacy

The page is a local file with no network access, no CDN and no remote fonts. Descriptions come from the already-redacted frozen corpus.

### Approvals required before execution

The page build and scripts are approved with this plan. No installs, downloads, model inference or hosted calls occur in this experiment.
