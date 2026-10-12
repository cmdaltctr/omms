# Experiment 20: catalogue version 2 and Clef top-three suggestions on new observations

- **ID**: `20-retrieval-catalogue-v2-fresh-test-2026-10-12`
- **Category**: retrieval
- **Size**: Standard
- **Status**: H1 PASS; H2 FAIL (87.5% against a 90% mark) (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [protocol](protocol.md); [Experiment 18](../18-retrieval-fresh-confirmation-all-methods-2026-10-12/report.md); [Experiment 19](../19-review-catalogue-v2-candidates-2026-10-12/report.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md)

## Answer

- **Question**: On 200 observations never used before, does catalogue version 2 leave fewer observations without a label, and does Clef's top three still contain the right label?
- **Answer**: Version 2 works: 33% of new observations fit no label, down from 50% under version 1. Clef's top three contains the right label for 87.5%, just under the 90% mark fixed in advance. Source: `output/summary.json`.
- **Decision**: Adopt catalogue version 2. Keep Clef's suggestions, but show five instead of three. Five reached 91% in an exploratory check; this needs confirming on fresh data.
- **How sure**: High for version 2: a large drop on unseen data. Medium for the suggestion list: 128 labelled cases, and the five-suggestion figure was found after looking.
- **Next step**: The final summary of Experiments 01 to 20.

## What ran

1. **Selection**: 200 of the 1,236 entries never used in Experiments 01 or 18, 100 per section, seed 20261013. The privacy filter excluded 3 (one home path, two long tokens). Source: `output/selection.json`.
2. **Labelling**: two blind AI agents labelled all 200 against the 56-label catalogue. They agreed on 178 (89%; G5 needs 75%). The drafter kept 6 disagreements and conceded 16. Final: 128 labelled, 64 `none_fit`, 2 uncertain, 6 disputed. Source: `output/reference-manifest.json`.
3. **Freeze**: the reference was hashed before the first Clef call.
4. **Clef**: 200 calls on the owned server with the version 2 options and examples from the 592-case gallery. 0 errors, about 4.6 seconds per item.
5. **Verify**: `--phase verify` matched every request hash and reproduced the summary without a server.

Tests: 4 focused tests pass; 5 deliberate faults in throwaway copies each made a test fail.

## Results

| Hypothesis                          | Result             | 95% interval   | Target | Verdict |
| ----------------------------------- | ------------------ | -------------- | ------ | ------- |
| H1: share with no label             | 64 of 192 (33.3%)  | 26.7% to 40.5% | ≤ 35%  | holds   |
| H2: right label in Clef's top three | 112 of 128 (87.5%) | 80.5% to 92.7% | ≥ 90%  | fails   |

Source: `output/summary.json`, keys `H1` and `H2`.

- **H1**: under version 1, Experiment 18 had 49.7% with no label. Version 2 cuts that by about a third. The interval's upper end, 40.5%, crosses the 35% mark, so the size of the gain is less certain than its direction.
- **H2**: the 94% seen in Experiment 18 did not hold. With 56 labels instead of 41, Clef has more options to spread its probability over.

### Descriptive (H3)

| Measure                                              | Value                                 |
| ---------------------------------------------------- | ------------------------------------- |
| Clef first pick right                                | 84 of 128 (65.6%); Experiment 18: 72% |
| Labelled observations using one of the 15 new labels | 38 of 128 (30%)                       |
| Clef top three right on new labels                   | 32 of 38                              |
| Clef said "no label fits" on `none_fit` cases        | 12 of 64 (19%)                        |

Source: `output/summary.json`, key `H3`. The new labels are used often, and Clef finds them nearly as well as the old ones.

### Exploratory: suggestion list length

| Suggestions shown | Right label on screen (of 128) |
| ----------------- | ------------------------------ |
| 1                 | 87 (68.0%)                     |
| 2                 | 103 (80.5%)                    |
| 3                 | 112 (87.5%)                    |
| 4                 | 115 (89.8%)                    |
| 5                 | 117 (91.4%)                    |

Source: `analysis.py`, from `output/raw.json`. Here the first suggestion skips "no label fits", which the review screen always offers anyway; that is why it shows 87, not 84.

## Limits

- The reference is AI-made. Production validity stays INCONCLUSIVE by `../AGENTS.md`; the operator chose AI labelling.
- 128 labelled cases; the five-suggestion result was found after looking.
- The 15 new labels have few examples in the gallery (102 in total), so their suggestions may improve as approvals add more.
- Clef still recognises only 19% of observations that fit no label. Automatic labelling stays closed.

## What this means

1. **Adopt catalogue version 2** (56 labels). A third fewer observations end up without a label.
2. **Show five Clef suggestions**, plus "No label fits". The right label is then on screen about 9 times in 10.
3. **Nothing else changes**: review-first assignment stays (ADR-024).
