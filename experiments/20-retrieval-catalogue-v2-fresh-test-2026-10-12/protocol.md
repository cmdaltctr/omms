# Experiment 20: catalogue version 2 and Clef top-three suggestions on new observations

- **ID**: `20-retrieval-catalogue-v2-fresh-test-2026-10-12`
- **Category**: retrieval
- **Size**: Standard
- **Status**: H1 PASS, H2 FAIL (2026-10-12); see [report](report.md)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [Experiment 18](../18-retrieval-fresh-confirmation-all-methods-2026-10-12/report.md); [Experiment 19](../19-review-catalogue-v2-candidates-2026-10-12/report.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md)

## 1. Question

On 200 observations never used before, does catalogue version 2 leave fewer observations without a label, and does Clef's top three still contain the right label?

The decision: whether OMMS adopts catalogue version 2, and whether Clef's top three is confirmed as the review-queue suggestion list.

## 2. Hypothesis

- **H1 (primary)**: under catalogue version 2, at most 35% of the scored new observations have the final reference `none_fit`. Under version 1, Experiment 18 had 195 of 392 (49.7%).
- **H2 (primary)**: Clef's three most likely labels contain the right label for at least 90% of labelled new observations. Experiment 18 found 94% after looking; this checks it with the mark fixed in advance.
- **H3 (descriptive)**: Clef's first pick accuracy (Experiment 18: 72%); Clef `none_fit` recognition; how many labelled observations use one of the 15 new labels.
- **H0**: for H1 and H2, the threshold is not met.
- **Decision rule**:
  - H1 holds: catalogue version 2 is recommended for OMMS.
  - H2 holds: Clef's top three is confirmed as the suggestion list in ADR-024.
  - Either fails: keep the current choice and report why.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                          | Primary metric                                                   | Guardrail metric                         | Fixed                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Catalogue version 1 vs version 2 (56 labels) | share of new observations with no label; Clef top-three hit rate | labeller agreement before reconciliation | Experiment 18 selection filters, labelling protocol, Clef request and server settings |

## 4. Data

| Item         | Value                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | `../01-label-decisions-2026-10-07/corpus/entries.json`, entries outside Experiment 01's 200 and Experiment 18's 400 (1,236)                                                               |
| Unit         | one profile observation                                                                                                                                                                   |
| Size         | 200: 100 preferences and 100 patterns                                                                                                                                                     |
| Gallery      | Experiment 01's 200 labelled cases plus Experiment 18's 400 with final labels, mapped to version 2: the 102 members of accepted new labels take those labels; disputed cases are left out |
| Labels       | two blind AI passes plus reconciliation, against catalogue version 2, frozen before any Clef call                                                                                         |
| Already seen | none of the 200                                                                                                                                                                           |

### Selection, frozen

Experiment 18's exclusion rules, unchanged, through its pinned `select_cases.py`: redaction, email, URL, home path, IPv4, long token, under 15 characters, and normalised duplicates of any gallery text. Seed 20261013, ids in order, shuffled per section, first 100 per section.

## 5. Steps

Run every command from the repository root. The operator approved this experiment on 2026-10-12.

1. Select: `uv run --project experiments --no-sync python experiments/20-retrieval-catalogue-v2-fresh-test-2026-10-12/prepare.py --phase select`
2. Label: pass 1 and pass 2 agents write `corpus/label-pass1.json` and `corpus/label-pass2.json`; the drafter writes `corpus/label-reconcile.json`.
3. Freeze: `prepare.py --phase freeze`
4. Run Clef: `run_eval.py --phase run --resume`
5. Verify without servers: `run_eval.py --phase verify`

## 6. Analysis

- **Stats level**: medium. Exact Clopper-Pearson 95% intervals on every proportion.
- **Test for H1 and H2**: observed proportion against the threshold, interval reported.
- **Gates**:

| Gate             | Pass when                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| G1 integrity     | all pins verify before and after                                                                |
| G2 privacy       | every selected text passes the exclusion rules                                                  |
| G3 blindness     | the reference is hashed before the first Clef call; labellers see no model output               |
| G4 completeness  | 200 valid Clef answers; errors count as wrong                                                   |
| G5 label quality | passes 1 and 2 agree on at least 75% before reconciliation; failure makes validity INCONCLUSIVE |

## Extra detail

### Clef request, frozen

Experiment 18's `clef_payload` and server settings, with the version 2 catalogue as options and the version 2 gallery as examples: up to 2 per label and 3 `none_fit`, closest first by Qwen3-Embedding-4B intent-instruction cosine. New observations are embedded through Experiment 16's runner. One option order.

### Input pins

| Input                                                                                   | SHA-256                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `../18-retrieval-fresh-confirmation-all-methods-2026-10-12/select_cases.py`             | `57e372bdabb0e49b4a94a759a890f70c96747410301cbe1e80a30b1375ef285d` |
| `../18-retrieval-fresh-confirmation-all-methods-2026-10-12/finalise_reference.py`       | `eb94121f0277a7dfe87ac95bff1118496dbd24c1bbddf5412fd6b41d432707d8` |
| `../18-retrieval-fresh-confirmation-all-methods-2026-10-12/run_eval.py`                 | `acbe4aa0362757eb4f2963ca31dd1c892d77f7a497dab7ca1595d49309ed8ee6` |
| `../18-retrieval-fresh-confirmation-all-methods-2026-10-12/output/fresh-vectors.json`   | `17109071e0659155062cb77c179aa4486f04cf96401fcbb92c46fb0cdfb5e544` |
| `../18-retrieval-fresh-confirmation-all-methods-2026-10-12/corpus/fresh-reference.json` | `906eb69719c245d7727e58ac7fa858f9bf3f083979e9c0c3a06c57d5d3749925` |
| `../19-review-catalogue-v2-candidates-2026-10-12/output/catalogue-v2.json`              | `7f393d3c4e989d1dbc40e14200db4119295e913faa38f31b99a539a9920dc45b` |
| `../19-review-catalogue-v2-candidates-2026-10-12/corpus/v2-members.json`                | `8444c343eb89e0f41b7497a9b5893733264ba11f63f898af25583aa759a935c0` |

### Validity

- The reference is AI-made. Production validity stays INCONCLUSIVE by `../AGENTS.md`; the operator chose AI labelling.
- The 15 new labels came from Experiment 18 data. This test uses only observations outside it.

### Scripts

`prepare.py` (phases `select`, `freeze`), `run_eval.py` (phases `run`, `verify`), `analysis.py`. Tests are outside the limit.

### Amendments

None at planning.
