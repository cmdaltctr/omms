# Experiment 18: fresh-data confirmation of cosine, reranker and Clef together

- **ID**: `18-retrieval-fresh-confirmation-all-methods-2026-10-12`
- **Category**: retrieval
- **Size**: Confirmatory (this plan is committed before any selection, labelling or model run)
- **Status**: PASS on H1 and H2; H4 FAIL as predicted (2026-10-12); see [report](report.md)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [ADR-024](../../docs/adr/024-review-first-label-assignment.md); Experiments 11, 15, 16 and 17

## 1. Question

Do the Experiment 17 findings hold on 400 fresh observations: three methods' picks together contain the right label, and their agreement marks a right label?

The decision: what the review queue shows (three suggestions, and an "all agree" hint), and whether "all agree" can ever assign a label automatically.

## 2. Hypothesis

Picks for each fresh observation:

- **Cosine pick**: the first existing label among the 10 most similar old observations.
- **Reranker pick**: the label definition that Qwen3-Reranker-0.6B scores highest.
- **Clef pick**: Clef's chosen label. A `none_fit` choice means no pick.

Hypotheses, judged only on fresh observations whose final reference is an existing label ("labelled" cases):

- **H1 (primary)**: the three picks together contain the right label for at least 85% of labelled cases. Experiment 17 saw 62 of 67 (93%).
- **H2 (secondary)**: when all three picks agree, the agreed label is right at least 90% of the time. Experiment 17 saw 30 of 31 (97%).
- **H3 (secondary, descriptive)**: first-pick accuracy of each method, and of a majority vote. Experiment 17 saw cosine 44, reranker 46, Clef 49 and vote 50, out of 67.
- **H4 (safety)**: "all three agree" used as an automatic rule passes Tier 2 of the Experiment 11 ruler. Accepted items include `none_fit` cases where all three agree, which count as wrong. Tier 2 needs the exact one-sided 95% upper bound on wrong picks at 5% or less. Prediction: fail, because Experiment 17 saw 7 agreements on `none_fit` cases.
- **H0**: for each hypothesis, the stated threshold is not met.

**Decision rule**:

- H1 holds: the review queue shows the three methods' picks.
- H2 holds: the review queue marks "all agree" picks as likely right.
- H4 holds: "all agree" becomes a candidate automatic rule for a later production proposal, which meets ADR-024's condition. H4 failing keeps review-first assignment unchanged.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                                      | Primary metric                                                     | Guardrail metric                                | Fixed                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Old 140 seen cases vs 400 fresh observations, never seen | share of labelled cases whose right label is among the three picks | agreement precision; `none_fit` agreement count | cosine, reranker and Clef settings from Experiments 15 to 17; the 41-label catalogue; the old 200 cases as the example gallery |

## 4. Data

| Item         | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Source       | `../01-label-decisions-2026-10-07/corpus/entries.json`: 1,836 profile entries; the 1,636 never used before |
| Unit         | one profile observation                                                                                    |
| Size         | 400 selected: 200 preferences and 200 patterns                                                             |
| Gallery      | the old 200 labelled cases (60 development, AI labels; 140 test, Experiment 10 reference)                  |
| Labels       | two independent AI labelling passes plus a reconciliation round, frozen before any model run               |
| Already seen | none of the 400; the gallery cases were used in Experiments 01 to 17                                       |

### Selection, frozen

1. Start from the 1,636 entries not in the Experiment 01 ground truth.
2. Exclude an entry when any of these hold:
   - `safety.redact()` changes its text: `<private>` content, private keys or API-style tokens.
   - It contains an email address, a URL, an absolute home path (`/Users/`, `/home/`, `C:\Users\`), an IPv4 address, or a run of 32 or more hex or base64 characters.
   - Its description is shorter than 15 characters.
   - Its lower-cased, whitespace-collapsed description equals a gallery description or an earlier selected one.
3. Shuffle each section's remaining entries with `random.Random(20261012)` in id order. Take the first 200 per section.

### Labelling, frozen

- **Input to both labellers**: each observation's id, section and description, plus every catalogue label in its section with definition and aliases. No model output, old reference or similarity score.
- **Pass 1 (drafter)** and **pass 2 (judge)**: two separate AI agent sessions, each blind to the other. Each gives one answer per observation: a label id, `none_fit` or `uncertain`. A `none_fit` answer may add a short proposed new label name.
- **Reconciliation**: the drafter sees each disagreement with both answers, then keeps its answer or concedes.
- **Final reference**: an agreed or conceded answer. A disagreement that remains becomes `disputed`. `uncertain` and `disputed` cases are left out of H1 to H4 and counted in the report.
- **Instruction to labellers**: "Pick the one label whose definition matches the observation's primary intent. Respect each definition's exclusions. Answer none_fit when no label's intent matches. Answer uncertain only when two labels fit equally."

## 5. Steps

Run every command from the repository root. The operator approved the plan, the selection, the AI labelling, the local model runs and the plan commit on 2026-10-12.

1. Commit the plan files (preregistration).
2. Select: `uv run --project experiments --no-sync python experiments/18-retrieval-fresh-confirmation-all-methods-2026-10-12/select_cases.py`
3. Label: pass 1 and pass 2 agent sessions write `corpus/label-pass1.json` and `corpus/label-pass2.json`. The drafter writes `corpus/label-reconcile.json`.
4. Freeze: `uv run --project experiments --no-sync python experiments/18-retrieval-fresh-confirmation-all-methods-2026-10-12/finalise_reference.py`
5. Run all three methods: `uv run --project experiments --no-sync python -u experiments/18-retrieval-fresh-confirmation-all-methods-2026-10-12/run_eval.py --phase run --resume`
6. Verify without servers: the same command with `--phase verify`.

## 6. Analysis

- **Stats level**: expert for a Confirmatory run. Exact Clopper-Pearson 95% intervals on every proportion. Exact two-sided sign tests on paired first-pick comparisons.
- **Test for H1 and H2**: the observed proportion against the threshold, with its 95% interval reported.
- **Test for H4**: Tier 2 rule, one-sided 95% upper bound at 5% or less.
- **Gates**:

| Gate             | Pass when                                                                                               | Why it matters                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| G1 integrity     | every input pin, GGUF, server binary and reused runner verifies before and after                        | results tie to frozen inputs                   |
| G2 privacy       | every selected text passes the exclusion rules; a test injects each kind of secret and sees it excluded | no private data reaches a model or a report    |
| G3 blindness     | the final reference is hashed before the first model call; labeller inputs hold no model output         | labels cannot follow the methods               |
| G4 completeness  | all 400 observations get a valid answer from each method; errors count as wrong                         | errors never count as right                    |
| G5 label quality | passes 1 and 2 agree on at least 75% of the 400 before reconciliation                                   | a weak reference would make every result shaky |

- **Stop rule**: stop when all three methods have scored all 400. Stop at once on G1, G2 or G3 failure. A G5 failure still runs, but validity becomes INCONCLUSIVE.

## Extra detail

### Method settings, frozen

- **Embeddings**: Qwen3-Embedding-4B Q8_0 with the Experiment 16 intent instruction, through Experiment 16's runner and its owned server on port 3007. Gallery vectors come from Experiment 16's saved `vectors-instruct.json`.
- **Cosine**: the 10 most similar same-section gallery observations; the pick is the first one with an existing label; top three are the first three distinct existing labels.
- **Reranker**: Qwen3-Reranker-0.6B, Experiment 17's Route B with the plain query, through Experiment 17's runner and its owned server on port 3008.
- **Clef**: Experiment 15's request and owned server on port 3005, with the batch fix from its amendment 1. Examples come from the gallery: up to 2 per label and 3 `none_fit`, closest first. One option order only, because Experiment 15 showed Clef's scores do not depend on order.

### Reported, not gated

- Clef `none_fit` recognition on fresh `none_fit` cases.
- Seconds per item for each method.
- Proposed new label names, grouped by hand into likely catalogue gaps (exploratory).
- Cases left out as `uncertain` or `disputed`.

### Input pins

| Input                                                                             | SHA-256                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `../01-label-decisions-2026-10-07/corpus/entries.json`                            | `3bf06ac9b1c710bda1d65b695929a59371516ca459bcd88458f16beca05769d4` |
| `../safety.py`                                                                    | `dd0629b8237eca6455fa580fb49f2815a9f7fbba802d8ebb7c8177d6b04c4628` |
| `../12-retrieval-neighbour-reuse-gate-2026-10-11/run_eval.py`                     | `10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b` |
| `../15-retrieval-clef-intent-select-2026-10-11/run_eval.py`                       | `bd370edb5cb13123628bb20e23ed99474b95e2304610911e67b0f24ea791ba10` |
| `../16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/run_eval.py`                  | `1ae069a177cf47e2231570103b8287eee5219fbae40c081ad9695788d8b3824c` |
| `../16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/output/vectors-instruct.json` | `133623b9b2c3ee8db067b4dfac488cfa362cc17795edada55c5c647b7b588a97` |
| `../17-retrieval-reranker-label-suggestions-2026-10-12/run_eval.py`               | `3fc38f0fc78227633b2bdaa3133d2c3e5de7741f4f736159626b8032bb34ab38` |

The reused runners check their own model files and pins: the 4B embedding GGUF, the reranker GGUF, the Clef manifest and the Experiment 12 corpus pins.

### Validity

- The reference is AI-made, by two independent agents. By `../AGENTS.md`, AI-only reference labels leave validity INCONCLUSIVE for production decisions. The operator chose AI labelling on 2026-10-12, because OMMS must later label without a person. The report states both.
- The labelling agents and the tested models are different models.

### Privacy and cloud

No hosted calls. Loopback servers only. Selected text stays in the git-ignored `corpus/` folder. Labeller agent sessions read only `corpus/label-input.json`. Logs hold counts, identifiers and hashes.

### Scripts

`select_cases.py`, `finalise_reference.py`, `run_eval.py` (phases `run`, `verify`) and `analysis.py`: 4 of the 5 allowed. Tests are outside the limit.

### Amendments

None at planning.
