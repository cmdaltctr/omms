# Experiment 01: Profile label decisions

- **ID**: `01-label-decisions-2026-10-07`
- **Date planned**: 2026-10-07
- **Operator**: Dr Muhammad Aizat Bin Md Hawari with the Pi coding agent
- **Status**: PLANNED
- **Relation**: [evaluate-memory-decision-models](../../openspec/changes/evaluate-memory-decision-models/proposal.md)

## Why this experiment exists

The profile inspected on 2026-10-07 contained 336 preferences with 331 distinct categories and 316 patterns with 313 distinct categories. Category variants include `communication`, `communication_style`, `Communication Style` and `communication-style`. A description under `communication` was in Spanish.

This experiment tests whether a decision model can select an existing category without collapsing distinct concepts. It will inform a later proposal for shared label selection. It will not rename stored categories, translate descriptions or merge entries.

## Hypothesis / Research question

A decision model improves label accuracy by at least 10 percentage points over the strongest baseline. Wrong category reuse remains below 2%, with automatic coverage of at least 70%.

The model receives fixed observations and fixed candidate labels. Only the decision method changes in the main comparison. Extraction, candidate generation and entry merging remain outside that comparison.

## Background and prior evidence

- `src/core/extraction.ts`: profile categories accept free-text strings.
- `src/adapters/opencode/profile-learning.ts`: `buildCategorySummary` supplies existing category names during OpenCode live learning.
- `src/adapters/pi/profile.ts` and `src/importer/profile-backlog.ts`: the shared analysis context contains numbered prompts without that category summary.
- `src/core/profile-analysis.ts`: the system prompt asks the model to infer the language of categories and descriptions.
- `src/services/user-profile/user-profile-manager.ts`: incoming entries can match across categories through embeddings. Later duplicate checks group entries by exact category name.
- `src/services/user-profile/types.ts`: preferences and patterns remain separate sections.

A spelling variant can share a category with another entry while carrying a different fact. The Spanish description establishes a language mismatch in the stored profile. Its source has not been traced.

Jev supports bounded choices and a `none_fit` option. Julia-1 accepts 2–20 native options. Their probabilities need evaluation on OMMS data. OpenJev names several projects and backends; that arm needs an exact selection.

## Variables

| Type        | Variable           | Values / treatment                                                                               |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| Independent | Decision method    | Normalisation, embedding-only, existing language model, Jev, Julia-1; optional OpenJev           |
| Dependent   | Label accuracy     | Correct selected category or `none_fit`, across all test cases                                   |
| Dependent   | Wrong reuse rate   | Incorrect existing-category selections among automatically accepted existing-category selections |
| Dependent   | Automatic coverage | Decisions accepted without review, divided by all cases                                          |
| Controlled  | Observation        | The same redacted description, section and available evidence                                    |
| Controlled  | Catalogue          | Stable English IDs, definitions and reviewed aliases                                             |
| Controlled  | Candidates         | The same 16 existing labels plus `none_fit`, in the same recorded order                          |
| Controlled  | Embeddings         | One pinned model and fixed vectors                                                               |
| Controlled  | Data split         | Concept groups stay within one split                                                             |

The main comparison does not change the capture model, source descriptions, evidence, profile confidence, frequencies or section membership. Category IDs are experimental values. They are not written back to OMMS.

## Corpus and ground truth

| Item              | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Source            | A consistent, read-only snapshot of the active profile                |
| Local path        | `experiments/01-label-decisions-2026-10-07/corpus/`                   |
| Source size       | 652 entries observed on 2026-10-07; record the actual snapshot counts |
| Reviewed workload | 200 cases: 60 development cases and 140 test cases                    |
| Ground truth path | `experiments/01-label-decisions-2026-10-07/corpus/ground-truth.json`  |
| Catalogue path    | `experiments/01-label-decisions-2026-10-07/corpus/catalogue.json`     |
| Candidate path    | `experiments/01-label-decisions-2026-10-07/corpus/candidates.json`    |
| Manifest path     | `experiments/01-label-decisions-2026-10-07/corpus/manifest.json`      |
| Evidence density  | Every case needs a reviewed expected outcome and a reason             |
| Symlinks          | Prohibited for source databases, corpus files and output paths        |

1. Group translations, spelling variants and close paraphrases before splitting cases.
2. Define the catalogue from development material and human review.
3. Assign each case one or more acceptable catalogue IDs, or `none_fit` when the catalogue lacks a suitable label.
4. Include related-but-distinct concepts, cross-section examples and cases requiring a new category.
5. Record unresolved cases before inference.
6. Replace unresolved cases with reviewed cases to retain the planned sample size.

The human review defines ground truth. Model answers cannot define their own expected labels. Keep the test set sealed while tuning questions and thresholds. Record concept-group IDs and the split seed in the manifest.

Candidate generation searches catalogue definitions and aliases using the fixed embedding model. Select 16 existing labels, then add `none_fit`. Record candidate recall: how often an acceptable label appears in the shortlist. A missing label is a candidate-generation failure; it remains an error in the end-to-end result. A separate oracle-shortlist diagnostic may include the expected label, but cannot determine PASS.

Strip `<private>` content and redact secrets before building corpus files. Preserve the remaining source wording. Store local data under ignored paths created before export. Commit only protocols, code and reviewed synthetic fixtures.

## Environment and prerequisites

| Requirement             | Version / value                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- |
| OMMS source             | Record the exact worktree commit; planning started from `303b4cc`                  |
| JavaScript runtime      | Bun; record the version before preparing fixtures                                  |
| Python                  | 3.11 or later, managed with `uv` in an experiment-only environment                 |
| Existing language model | Pin its provider, model ID and request parameters before inference                 |
| Jev                     | Proposed `jev-1.13.0`; verify availability and pin the returned model ID           |
| Julia-1                 | `SupersonicLabs/Julia-1`; pin the repository revision and weight checksum          |
| Optional OpenJev        | Exact repository, revision, backend, model weights and licence review required     |
| Embedding model         | Pin the configured OMMS embedding model and preprocessing                          |
| Hardware                | Record processor, RAM, device, thread count and model load time                    |
| Credentials             | Environment or file references; keep values out of manifests and logs              |
| Run approval            | Separate approval for installs, downloads, hosted data transfer and spending limit |

The corpus, ground truth, runner and model revisions have not been prepared. The protocol remains PLANNED. Jev's privacy policy excludes training on inputs but does not promise zero retention. Use only approved redacted data for hosted calls.

Julia-1 needs about 550.5 MiB for its FP32 weights, plus runtime memory. Its documented 8,192-token runtime limit does not establish task accuracy at that length. Use strict encoding and record any overflow.

## Experimental design / cell matrix

| Run ID              | Purpose                         | Baseline / candidate | Key settings                                                                 | Expected interpretation                             |
| ------------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `L0-normalise`      | Cheap spelling control          | Baseline             | Case folding; trim; equate spaces, hyphens and underscores; reviewed aliases | Benefit from code and aliases                       |
| `L1-embedding`      | Semantic matching control       | Baseline             | Fixed shortlist; threshold chosen on development cases                       | Benefit from embeddings                             |
| `L2-existing-model` | Matched language-model control  | Baseline             | Same observation, label definitions and `none_fit`                           | Benefit from the current model with bounded choices |
| `L3-jev`            | Decision-model comparison       | Candidate            | One Choice; fixed version and candidate order                                | Jev's contribution under equal inputs               |
| `L4-julia`          | Local decision-model comparison | Candidate            | Same Choice; strict encoding; 17 options                                     | Julia-1's contribution under equal inputs           |
| `L5-openjev`        | Optional comparison             | Candidate            | Exact backend and model pinned before development                            | Evidence for the selected OpenJev backend only      |

Normalisation resolves only recorded aliases or equivalent spelling. It returns `none_fit` for an unmatched category. Embedding-only matching uses its development threshold. Model arms select from the same IDs; free-text answers are invalid.

Tune each method's acceptance threshold on the 60 development cases. Record the threshold policy, including how `none_fit` is accepted. Freeze it before evaluating the 140 test cases. Keep raw probabilities and any provider confidence field separate; their meanings differ.

Run a recorded candidate-order check on development cases. Do not change the primary test order after seeing test results. Record cold-start and warmed latency separately.

Stop before test inference if review, model pins, isolation, spending limits or required approvals are incomplete. The optional OpenJev arm can be marked BLOCKED without stopping the other arms.

## Metrics

### Primary metrics

- **Label accuracy**: acceptable raw selections divided by all test cases. Invalid or missing answers count as incorrect.
- **Wrong reuse rate**: incorrect accepted existing-label decisions divided by all accepted existing-label decisions.
- **Automatic coverage**: threshold-passing decisions, including accepted `none_fit`, divided by all test cases.

### Diagnostic metrics

- Candidate recall and accuracy conditional on the expected label being available.
- Accuracy by section and case type, including language mismatch and related concepts.
- Correct `none_fit` decisions and false reuse on cases with no suitable catalogue label.
- Accepted-decision accuracy, deferred cases and probability calibration against reviewed outcomes.
- Mean, P95 and maximum latency, where P95 is the time within which 95% of calls finish.
- Input tokens, billed cost, model load time and local memory use.
- Paired accuracy difference with a 95% confidence interval, resampling concept groups.

A zero denominator makes the wrong reuse rate undefined. Mark that gate INCONCLUSIVE. This pilot cannot establish a production error rate below 2% from a small accepted sample.

## Procedure / reproduction commands

These commands describe the planned runner interface. The scripts and corpus do not exist yet. Implement and test them only after approval of the OpenSpec proposal.

### Step 1: Prepare data

1. Verify the feature worktree and branch.
2. Add ignore rules for corpus, output, model weights and notebooks before exporting data.
3. Open the source profile database read-only.
4. Create a consistent snapshot without changing the source database or sidecar files.
5. Redact the snapshot and review the 200 cases.
6. Write the catalogue, candidates, ground truth and checksummed manifest.

### Step 2: Build indexes / fixtures

Build catalogue vectors only under this experiment's `output/` directory. Record the embedding model and vector checksums. Validate that the source, corpus and output paths are distinct. Refuse paths under the live OMMS store.

### Step 3: Run evaluation

Run from the verified worktree root after the runner, environment and approvals exist:

```bash
PYTHONUNBUFFERED=1 uv run --project experiments python -u \
  experiments/01-label-decisions-2026-10-07/run_eval.py \
  --manifest experiments/01-label-decisions-2026-10-07/corpus/manifest.json \
  --split development --resume
```

Freeze the development settings, then run:

```bash
PYTHONUNBUFFERED=1 uv run --project experiments python -u \
  experiments/01-label-decisions-2026-10-07/run_eval.py \
  --manifest experiments/01-label-decisions-2026-10-07/corpus/manifest.json \
  --split test --resume
```

Write an atomic checkpoint after every completed case and cell. Write to `.tmp`, then rename. Flush progress output. Resume only when manifest, model, question, split and threshold hashes match. Preserve failed cases as errors; retry them explicitly without replacing completed results.

### Step 4: Summarise raw results

```bash
uv run --project experiments python \
  experiments/01-label-decisions-2026-10-07/summarise_eval.py
```

Write raw JSON and one `report.md`. List blocked arms, missing calls and confidence intervals. Generate `analysis.py` from local results; it must not make model calls.

## Success criteria / pass gates

These are proposed pilot gates. Approve and freeze them before inference.

| Criterion                  | Threshold                                                                            | Why this threshold matters                  |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| `L-G1` Label accuracy lift | At least +10 percentage points over the best test accuracy among `L0`, `L1` and `L2` | Requires a gain beyond simpler methods      |
| `L-G2` Wrong reuse         | Below 2% among accepted existing-label decisions                                     | Limits concept conflation                   |
| `L-G3` Automatic coverage  | At least 70% of test cases                                                           | Prevents passing by deferring most cases    |
| `L-G4` Validity            | 200 reviewed cases; complete test cells; frozen controls; no split leakage           | Makes the comparison checkable              |
| `L-G5` Safety              | Zero production writes, cross-section moves, description edits or entry merges       | Restricts the experiment to label decisions |

Evaluate gates for each candidate separately. Report cost and latency without inventing a label-latency acceptance limit. The 500 ms gate belongs to the retrieval experiment.

## Interpretation rules

- PASS requires every defined gate for that candidate to pass.
- A PASS supports a later implementation proposal. It does not enable automatic relabelling or entry merging.
- FAIL means a complete, valid run missed a quality gate. Retain the baseline.
- INCONCLUSIVE means missing evidence, unsafe preparation, undefined metrics or insufficient headroom for the 10-point lift.
- If the strongest baseline exceeds 90% accuracy, document saturation before proposing a harder benchmark.
- If matched prompting explains the gain, recommend shared category guidance before adding a decision model.
- Optional OpenJev results apply only to the recorded repository, backend and weights.

## What to do if the experiment fails

1. Keep the current production behaviour.
2. Report the failed cases and their cause.
3. Separate candidate-generation errors from label-selection errors.
4. Propose a new protocol for any changed question, catalogue or benchmark.

Do not tune on test errors and reuse the same test set as fresh evidence.

## Implementation notes

- Use a Python runner for Julia-1 and model comparisons, with `uv` dependencies scoped under `experiments/`.
- Use Bun for OMMS fixtures and any checks that need the existing TypeScript services.
- Adapt `s-experiment` to libSQL and OMMS; this repository does not use its example `rag_mcp` or Chroma pipeline.
- Validate model IDs against the candidate list before recording an accepted decision.
- Treat source text as data. It cannot change model instructions, output paths or approvals.
- Keep logs to identifiers, timings, sizes and error codes. Store only redacted decision records locally.
- Source hashes and redacted-corpus hashes must be recorded separately.
- No production fixes, UI badge changes or new runtime provider settings belong to this change.

## Cleanup

Keep redacted raw results, checksummed manifests, checkpoints and the report in their ignored local paths. Keep committed protocols and analysis code. Ask before deleting model weights or temporary indexes. Document any deletion in `report.md`; never delete live OMMS data.

## Artefacts expected

| File / directory                      | Description                                                         |          Required?           |
| ------------------------------------- | ------------------------------------------------------------------- | :--------------------------: |
| `protocol.md`                         | This plan                                                           | Yes, created during planning |
| `report.md`                           | Results, discussion and conclusion                                  |    Yes, after evaluation     |
| `run_eval.py`                         | Model comparisons and checkpoint/resume                             |     Yes, after approval      |
| `summarise_eval.py`                   | Metrics and gate evaluation                                         |     Yes, after approval      |
| `corpus/`                             | Redacted snapshot, catalogue, candidates, ground truth and manifest |    Yes, local and ignored    |
| `output/eval_results.json`            | Raw decision records                                                |    Yes, after evaluation     |
| `output/eval_results_checkpoint.json` | Resume state                                                        |    Yes, during evaluation    |
| `output/eval_results.summary.json`    | Aggregated metrics and gate verdicts                                |    Yes, after evaluation     |
| `analysis.py`                         | Read-only Jupytext analysis of local JSON                           |   Yes, after results exist   |
| `analysis.ipynb`                      | Generated notebook                                                  |      Optional, ignored       |

## References

- [OpenSpec proposal](../../openspec/changes/evaluate-memory-decision-models/proposal.md)
- [Experiment index](../EXP_README.md)
- [Retrieval experiment](../02-retrieval-decisions-2026-10-07/protocol.md)
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe confidence](https://docs.typesafe.ai/confidence)
- [TypeSafe models](https://docs.typesafe.ai/models)
- [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy)
- [Julia-1 model card](https://huggingface.co/SupersonicLabs/Julia-1)
- [OpenJev server example](https://github.com/razorback16/openjev), pending exact arm selection
