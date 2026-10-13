# Experiment 09: verification gate before first label reuse

- **ID**: `09-retrieval-verify-label-reuse-2026-10-11`
- **Category**: retrieval
- **Size**: Standard
- **Status**: PLANNED
- **Operator**: Dr Muhammad Aizat Md Hawari, with a planning agent
- **Related**: [evaluate-memory-decision-models change](../../openspec/changes/evaluate-memory-decision-models/proposal.md); Experiments 03, 04, 05 and 06

## 1. Question

Can a calibrated binary verification gate on the classifier's chosen label bring wrong reuse below 2% while retaining at least 19 correct matches?

The decision: whether verification-gated reuse merits a production design proposal, and which verifier class suits it.

## 2. Hypothesis

- **H1 (primary)**: at least one verifier arm meets every functional gate on the 140 saved cases.
- **H0**: no verifier arm meets every gate.
- **Decision rule**: an arm that passes all gates becomes the candidate mechanism for a later production proposal. If no arm passes, stop; do not propose another prompt or model change from this evidence.

## 3. What changes, what is measured, what stays fixed

| Changes (one gate, two arms)                | Primary metric                        | Guardrail metric                             | Fixed                                                    |
| ------------------------------------------- | ------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| baseline (no gate) vs NLI gate vs Clef gate | wrong reuse W/E among accepted reuses | correct matches retained (C) and review load | proposer answers, corpus, catalogue, reference, sections |

The proposer makes no fresh calls. The gate reads Experiment 06's saved answers and verifies each existing-label pick once. `none_fit` answers pass through unchanged. Cached-repeat routing from Experiments 07 and 08 stays out of scope; this experiment measures first-assignment decisions only.

## 4. Data

| Item         | Value                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Source       | Experiment 06 saved answers; Experiment 01 revision-01 corpus                                                          |
| Unit         | one observation case                                                                                                   |
| Size         | 140 test cases: 71 picks verified per arm, 69 `none_fit` pass through; 60 development cases for calibration            |
| Groups       | 51 catalogue labels in two sections; three frozen boundary cases and three omitted-candidate cases reported separately |
| Labels       | AI-authored reference (a-writer, 2026-10-07), not human reviewed                                                       |
| Already seen | Experiments 01, 04, 05 and 06 used the test cases; the development cases defined the catalogue                         |

## 5. Steps

Run every command from the repository root. Steps 0 to 4 need separate approval before execution.

0. Approved installs: `uv add --project experiments onnxruntime tokenizers`. Record exact versions in the run manifest.
1. Run the focused tests: `uv run --project experiments --no-sync python -m pytest experiments/09-retrieval-verify-label-reuse-2026-10-11/test_run_eval.py`
2. Calibrate the NLI arm: `uv run --project experiments --no-sync python -u experiments/09-retrieval-verify-label-reuse-2026-10-11/run_eval.py --phase calibrate --arm nli --resume`
3. Calibrate the Clef arm: same command with `--arm clef`, with the owned server running on `127.0.0.1:3004`
4. Test both arms: same command with `--phase test --arm nli` then `--arm clef`, both with `--resume`
5. Verify read-only: `uv run --project experiments --no-sync python experiments/09-retrieval-verify-label-reuse-2026-10-11/run_eval.py --verify`

## 6. Analysis

- **Stats level**: basic counts and rates, plus one exact interval (see `stats-levels.md`).
- **Test for H1**: gate evaluation per arm. No significance test.
- **Interval**: exact one-sided 95% binomial upper bound on wrong reuse among accepted reuses, computed by standard-library summation.
- **Gates**:

| Gate            | Pass when                                                                                 | Why it matters                                 |
| --------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| G1 integrity    | all pinned hashes verified; calibration frozen before test; preserved originals unchanged | the comparison stays tied to the frozen inputs |
| G2 completeness | all 140 cases classified per arm as accepted reuse, review or error                       | silent drops would distort every rate          |
| G3 safety       | E > 0 and unrounded W/E < 0.02 among accepted reuses                                      | an unverified-looking pick must not be reused  |
| G4 retention    | C >= 19 correct accepted matches                                                          | blocking everything cannot pass                |
| G5 review load  | routed plus error cases at most 70% of 140                                                | the review queue must stay workable            |

- **Stop rule**: stop when both arms finish the test phase. Stop an arm early when its calibration fails; that arm does not run on test. Stop everything on an integrity failure.
- **What each outcome means**:
  - Pass (at least one arm): that arm is the candidate mechanism for a production design proposal in a separate change.
  - Fail (no arm): verification gates of this class do not fix first-assignment reuse on this evidence. Stop.
  - Unclear (an arm blocked by errors or a boundary gate value): report INCONCLUSIVE for that arm; do not retune.

## Extra detail

### Arms table

| Arm      | Verifier                                                       | Score                                   | Accept rule                                          |
| -------- | -------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| baseline | none; saved Experiment 06 answers                              | not applicable                          | every pick accepted                                  |
| nli      | `cross-encoder/nli-deberta-v3-small`, official int8 ARM64 ONNX | softmax P(entailment) over three logits | argmax is entailment and P(entailment) >= frozen tau |
| clef     | Experiment 03-pinned Clef-Flash-Q8_0 through a local server    | P(yes) from native choice probabilities | P(yes) >= frozen tau                                 |

### Calibration on the development split

Build these pairs per arm, before any test inference:

- 60 positive pairs: each development case with its expected label's definition.
- 1470 negative pairs: each development case with every other same-section definition. Preferences give 30 x 28 = 840; patterns give 30 x 21 = 630.
- Grid: 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95.
- Choose the smallest threshold whose wrong accepts are at most 2% of accepted pairs and which retains at least 45 of 60 positives. Freeze both thresholds in `output/calibration.json` and the run manifest before the test phase. An arm with no qualifying threshold fails calibration and does not run on test.
- Accepted risk: development negatives are same-section definitions, not the proposer's near-neighbour wrong picks. A calibrated threshold can look stronger on development than on test. The test gates decide, and this risk is stated in the report.

### Pair construction, frozen

- NLI premise: the observation description verbatim, after `<private>` stripping and the secret check.
- NLI hypothesis: `The primary requirement of this observation is to ` plus the definition, first letter lowercased, with a trailing full stop.
- Clef message: the observation description and section, then the candidate id and definition, then: `Does this category definition describe the observation's primary requirement? Answer yes or no.` Options `yes` and `no` only. Temperature 0, fixed seed when the runtime supports it, native choice probabilities.

### Environment

- NLI: repository `cross-encoder/nli-deberta-v3-small`, revision `fa2804872c3b4bd748f38c0185cc85775361e735`. File `onnx/model_qint8_arm64.onnx`, SHA-256 `a1da6815c8da542d16381c7d84892d409b4b6604d655bb3054ecb15dd8714e6e`, 172,503,006 bytes. `tokenizer.json` is 8,656,624 bytes; record its SHA-256 at download. Label order from `config.json`: 0 contradiction, 1 entailment, 2 neutral. Runs offline on CPU through onnxruntime.
- Quantisation note: int8 scores can shift slightly from F32. Each arm's threshold is calibrated on the same artefact used at test, so each arm stays internally consistent.
- Clef: the Experiment 03-pinned llama.cpp build and Clef-Flash-Q8_0 weights, re-verified against Experiment 03's recorded manifest at implementation. Any drift needs a recorded amendment. The runner owns one server on `127.0.0.1:3004`, refuses an occupied port and stops only its own child process.

### Input pins

`R` means `../01-label-decisions-2026-10-07/output/revision-01-batch8192/`.
`B` means `../06-retrieval-primary-intent-label-selection-2026-10-10/`.

| Input                            | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `B/output/eval_results.json`     | `89de5774c588343003021abe4ddf1343ee37d453d67aa781946155133ec808e8` |
| `B/output/summary.json`          | `be31ba0664ecc7be3bba09e407ec0cea0618c0a62db8f591a783a6a06f8ac18b` |
| `B/output/run-manifest.json`     | `6f6d4738325d1cf704b39a0d6d4f030e692fd2f71b5dd3a587ffb1e263cb9c5a` |
| `R/corpus/ground-truth.json`     | `8a4771923c458c45aff494839adf932eb42cdd72cf8bd452c44074bba7484f7c` |
| `R/corpus/catalogue.json`        | `3d9af990a51225037e5bca52bcaa28ca0d9486da7166a02d27cbb2366f0d52bc` |
| `R/corpus/candidates.json`       | `c783b5522d44e33c86c1b6969790118b875c35f3c6d96c21bbbe151c4c7d9560` |
| `R/corpus/test-manifest.json`    | `9572035106415d4c60d608c7948185fa08b030c18c79fa386f53f2935b8bbefd` |
| `R/corpus/annotation-notes.json` | `666e54104ce50a6b0eb8eb3bb4e6e94e53debb0718648413e58f64816a252f61` |

Also verify every entry in `R/preserved-files.json` before and after the run, as in Experiment 05.

### Frozen subgroups

Report these separately; they never replace the full-set gates. Values copied from Experiment 06.

| Subgroup              | Case IDs                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| omitted candidates    | `f37f028b607ada53080ffd18`, `b1cb9c6fabb574250de3f653`, `eab23004788a8de9ea82bc8f` |
| frozen boundary cases | `1467cebd77184343247fa302`, `188c3c023907447d10523239`, `1f9560db54792f236cf58285` |

### Privacy and cloud

No hosted calls. The NLI arm runs offline after the approved download. The Clef arm uses a loopback server only. Never log prompt or reply text; record sizes, identifiers and codes. Descriptions come from the redacted frozen corpus; the runner still checks for `<private>` content and secrets before sending.

### Approvals required before execution

1. Install `onnxruntime` and `tokenizers` into the experiments project.
2. Download the two pinned NLI files, about 172 MB plus 8.6 MB.
3. Start the owned Clef server and run calibration and test inference.

Planning creates none of these approvals.

### Cleanup

The ONNX file stays in the experiment's ignored output folder for verification. Delete it only after the user accepts the report.

### Amendments

None at planning.
