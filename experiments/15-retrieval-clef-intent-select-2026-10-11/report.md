# Experiment 15: Clef selects the intent label, with retrieved examples and shuffled order

- **ID**: `15-retrieval-clef-intent-select-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: FAIL — safe but starved at the 0.9 cut-off (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [protocol](protocol.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md); Experiments 06, 11, 12 and 14

## Answer

- **Question**: Can Clef, choosing among every same-section label with its definition and closest past examples, reuse labels with zero wrong picks and at least 29 correct, under two option orders?
- **Answer**: No. Clef never reached 0.9 confidence, so the gate accepted nothing: 0 correct, 0 wrong, 140 parked. Source: `output/summary.json`, key `counts`.
- **Decision**: Review-first assignment stays (ADR-024). The planned follow-up, statistical cut-off calibration, cannot rescue this. Even a cut-off chosen by looking at the test answers keeps only 9 correct with zero wrong.
- **How sure**: High. All 280 calls succeeded, and the exploratory curve shows the ceiling directly.
- **Next step**: Stop automatic first-assignment experiments on this catalogue until labels have many more reviewed examples.

## What ran

1. Attempt 1 made 280 calls. All returned HTTP 500, because the server's batch limit (512 tokens) was below the prompt size (about 900 to 2,900 tokens). It produced no answers. Kept in `output/attempt-1-batch512/`.
2. Amendment 1 raised the batch limit to 8,192, as Experiment 01 did. Same pinned binary, weights and prompts. One real request was checked first.
3. Attempt 2 made 280 calls with 0 errors, about 3 seconds each. The owned server on port 3005 stopped afterwards.
4. `--phase verify` rebuilt every prompt, matched each saved prompt hash, and reproduced the decisions and summary without a server.

Focused tests: 9 pass. 10 deliberate faults in throwaway copies each made at least one test fail.

## Results

### Frozen result

| Measure                    | Value        |
| -------------------------- | ------------ |
| Accepted (E)               | 0            |
| Correct (C)                | 0            |
| Wrong (W)                  | 0            |
| Parked                     | 140          |
| Call errors                | 0            |
| Same choice in both orders | 140 of 140   |
| Tier 1 (W = 0 and C ≥ 29)  | fail         |
| Largest prompt             | 2,926 tokens |

Source: `output/summary.json`.

| Gate            | Result                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| G1 integrity    | pass: pins, Clef GGUF and server hashes verified before and after         |
| G2 completeness | pass: 280 saved replies, 0 errors in attempt 2                            |
| G3 fold hygiene | pass: examples only from each case's outer gallery; the leak test refuses |
| G4 Tier 1       | fail: C = 0                                                               |

### The order shuffle tested nothing

Clef's probabilities were identical in both orders, down to every decimal place. Its native choice scoring ignores option order. So the "same answer under two orders" rule, taken from the literature review, added no protection with this model. Source: `analysis.py`, from `output/calls.json`.

### Exploratory: what other cut-offs would have done

These look at the test answers, so they are exploratory only.

| Cut-off           | Correct | Wrong | Parked |
| ----------------- | ------: | ----: | -----: |
| none (every pick) |      49 |    80 |     11 |
| 0.5               |      26 |    12 |    102 |
| 0.6               |      17 |     7 |    116 |
| 0.7               |      11 |     1 |    128 |
| 0.8               |       3 |     0 |    137 |
| 0.9 (frozen)      |       0 |     0 |    140 |

Source: `output/summary.json`, key `exploratory`.

The most confident wrong pick had probability 0.725. Only 9 correct picks sit above it. So the best possible zero-wrong result on these cases is 9 correct. Tier 1 needs 29.

### What Clef got right

- Clef's confidence does carry signal. Correct picks have a median probability of 0.51; wrong picks have 0.27.
- Probability is spread across 20 to 23 options. The top choice reached at most 0.86.
- Clef recognised `none_fit` in only 10 of 73 `none_fit` cases. It picked a label for the other 63. Forcing a label onto a new observation is still the main error.
- The gate parked all 28 of Experiment 06's wrong picks on `none_fit` cases.

Source: `analysis.py`; `output/summary.json`, keys `none_fit_recognition` and `paired_experiment06`.

## Limits

- One local model, Clef-Flash-Q8_0. A larger model might separate intent better; this run cannot tell.
- Examples come from galleries with about 3 members per label. Development labels are AI-authored.
- The test reference is operator-arbitrated, and the 140 cases were used in earlier experiments.

## Where this leaves automatic first assignment

| Approach                                   | Best zero-wrong correct on 140 cases |
| ------------------------------------------ | -----------------------------------: |
| Neighbour gate, nested folds (Exp 12, 14)  |                                    1 |
| Clef select at 0.9, frozen (this)          |                                    0 |
| Clef select, cut-off tuned on test answers |                                    9 |
| Tier 1 needs                               |                                   29 |

Every method fails mainly on the same cases: observations that fit no label, which each method files under a label anyway.
