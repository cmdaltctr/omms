# Experiment 13: compare check with Clef, agreeing with the neighbours

- **ID**: `13-retrieval-compare-check-gate-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: WITHDRAWN without a run (2026-10-11). Experiment 12 capped this design at 32 correct; the operator chose review-first assignment (ADR-024).
- **Operator**: Dr Muhammad Aizat Md Hawari, with a planning agent
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 03, 09, 11 and 12

## 1. Question

Does asking Clef to choose between the two closest labels, shown with their past examples, keep more correct matches than the neighbour gate alone, still with zero wrong picks?

The decision: whether the production candidate is the neighbour gate alone or the neighbour gate plus the Clef compare check.

## 2. Hypothesis

- **H1 (primary)**: the agreement gate passes Tier 1 (W = 0 and C ≥ 29), and its C is higher than Experiment 12's C on the same 140 cases.
- **H0**: W > 0, or C < 29, or C is not higher than Experiment 12's.
- **Decision rule**:
  - H1 holds: the agreement gate is the candidate. Tier 2 needs fresh labelled data.
  - W = 0 but no gain over Experiment 12: drop the Clef step and keep the neighbour gate.
  - W > 0: the agreement gate is unsafe at a cut-off of 0.9. Do not retune on these cases.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                                                       | Primary metric                                         | Guardrail metric                          | Fixed                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Experiment 12 neighbour gate vs closest-neighbour label confirmed by Clef | Tier 1, then C against Experiment 12 on the same cases | swap consistency; parked count (reported) | Experiment 12 folds and galleries, Experiment 11 ruler, Experiment 03-pinned Clef runtime |

## 4. Data

| Item         | Value                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Source       | Experiment 12 frozen folds and predictions; Experiment 01 corpus; Experiment 10 reference       |
| Unit         | one observation case                                                                            |
| Size         | 140 test cases, 2 Clef calls each (A and B swapped): 280 calls                                  |
| Groups       | Experiment 12's 5 group-based folds; each case's examples come only from its own outer gallery  |
| Labels       | as Experiment 12                                                                                |
| Already seen | as Experiment 12. The cut-off is fixed now, before any call, so nothing is tuned on these cases |

## 5. Steps

Run every command from the repository root. Implementation, the owned Clef server and inference each need approval first.

1. After Experiment 12 completes, pin its `output/folds.json` and `output/predictions.json` as amendment 1, before any call.
2. Run the focused tests: `uv run --project experiments --no-sync python -m pytest experiments/13-retrieval-compare-check-gate-2026-10-11/test_run_eval.py`
3. Run with the owned server: `uv run --project experiments --no-sync python -u experiments/13-retrieval-compare-check-gate-2026-10-11/run_eval.py --phase run --resume`
4. Verify read-only, without a server: `uv run --project experiments --no-sync python experiments/13-retrieval-compare-check-gate-2026-10-11/run_eval.py --phase verify`

## 6. Analysis

- **Stats level**: basic counts and rates, plus one exact interval.
- **Test for H1**: Tier 1 rule, then a paired count of C against Experiment 12. No significance test.
- **Interval**: exact one-sided 95% upper bound on W/E.
- **Gates**:

| Gate            | Pass when                                                                                                    | Why it matters                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| G1 integrity    | all pins verify, including Experiment 12 outputs and the Clef GGUF and server hashes, before and after       | the result stays tied to frozen inputs |
| G2 completeness | 280 valid replies, or a case with an invalid reply is parked and counted as an error                         | errors never count as correct          |
| G3 fold hygiene | each prompt's examples come only from the case's own outer gallery; a test injects a leak and sees a refusal | the check must not see the answer      |
| G4 Tier 1       | W = 0 and C ≥ 29                                                                                             | the screening bar                      |
| G5 gain         | C is higher than Experiment 12's C                                                                           | Clef must earn its cost                |

- **Stop rule**: stop when all 280 calls are saved. Stop at once on G1 or G3 failure, or on runtime drift.
- **What each outcome means**:
  - Pass: the agreement gate is the candidate; plan the Tier 2 fresh set.
  - Safe but no gain: keep the neighbour gate alone.
  - Unsafe: stop this design at 0.9; do not retune on these cases.

## Extra detail

### The agreement gate, frozen

1. From the case's Experiment 12 neighbour list, take the closest same-section member. If its label is `none_fit`, park the case.
2. Otherwise call that label X. Call Y the next different existing label among the neighbours. If no Y exists, park the case.
3. For X and Y, take up to 3 members of each label from the case's outer gallery, closest first.
4. Ask Clef twice: first with A = X and B = Y, then with A = Y and B = X.
5. Accept X only if the first reply chooses A and the second chooses B, each with probability at least 0.9.
6. Any other reply parks the case, including `both` and `neither`. The gate never writes `none_fit` by itself.

### Clef request, frozen

- Endpoint `/v1/systemone` on an owned loopback server, model `clef-flash`, as in Experiment 09.
- State: the observation description and section. Then options A and B, each with label id, definition and up to 3 example descriptions.
- Question, type choice: `Which category does the new observation belong with? Compare it with each category's definition and past examples.`
- Choices: `A` (belongs with category A), `B` (belongs with category B), `both` (fits both equally), `neither` (fits neither).
- Native choice probabilities. Temperature 0. No generation.

### Reported, not gated

- Swap consistency: the share of cases where both orders give the same label or the same `both` or `neither` answer.
- Parked count and holding-pen groups, as in Experiment 12.
- Paired table against Experiment 12: cases both accept, only one accepts, and neither accepts.
- Exploratory: the result at cut-offs 0.5, 0.6, 0.7, 0.8 and 0.95, and Clef without the neighbour agreement. Labelled exploratory, because these look at test cases.

### Environment

- Clef: the Experiment 03-pinned llama.cpp build and Clef-Flash-Q8_0 weights, verified against `../03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json` (SHA-256 `24918e90eea694464e58d6552d1cc4582dfd27f7b37ff664131f500e7fe53db6`). Any drift needs a recorded amendment.
- The runner owns one server on `127.0.0.1:3005`. It refuses an occupied port and stops only its own child process.
- Prompts with 6 examples may be long. A prompt over 8,192 input tokens counts as an error and parks the case.

### Input pins

Experiment 13 pins all Experiment 12 inputs, plus the Experiment 03 Clef manifest above. Experiment 12's `output/folds.json` and `output/predictions.json` are pinned by amendment 1 after Experiment 12 completes.

### Privacy and cloud

No hosted calls. Loopback server only. Descriptions come from the redacted frozen corpus. The runner still checks for `<private>` content and secrets before sending. Never log prompts or replies. Log sizes, identifiers and codes.

### Approvals required before execution

1. Implementation of `run_eval.py` and its tests.
2. Starting the owned Clef server and making the 280 calls.

### Scripts

`run_eval.py` with phases `run` and `verify`. `analysis.py` after results. Tests are outside the three-script limit.

### Amendments

None at planning. Planned at commit `fb699eb7c85ee30a12218e5b375f54ba78c5592c`.
