# Experiment 01: label decisions

**Status: COMPLETE. Verdict: INCONCLUSIVE. Clef fails the quality and wrong-reuse gates.**

## Run and result

The user approved real DeepSeek versus Clef inference under the US$5 cap. The canonical run is `output/revision-01-batch8192/`. It retains the revised corpus, pinned binary and Q8_0 weights. Native Choice needed physical batch and microbatch sizes of 8192; the original 512-token batch rejected a 526-token synthetic probe. The failed attempt remains in `output/revision-01/`, and its hosted charges count towards the same cap.

All 360 development records are complete. Two DeepSeek replies consumed the 1024-token output allowance entirely on reasoning; their failure records were preserved and an explicit failed-only retry succeeded. The saved freeze precedes test inference. Acceptance thresholds are `L0=0`, `L1=0.8`, `L2=0.95`, and `L3=0`.

Candidate coverage is 60/60 development positives and 51/54 test positives. Three omitted test targets remain end-to-end errors. All 920 required records are saved: 360 development records and 560 test records. Failures remain in the scored test set.

### Frozen test results

Accuracy counts correct raw decisions across all 140 cases, including failed calls as wrong. Accepted coverage is the proportion of decisions meeting the development-frozen threshold. Wrong reuse counts accepted existing-label decisions that disagree with the reference.

| Arm | Correct / 140 | Accuracy | Accepted coverage | Wrong accepted reuses / accepted reuses | Failed calls | Mean decision time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normalisation | 85 | 60.7% | 100% | 1 / 1 | 0 | 0.00064 s |
| Embeddings | 28 | 20.0% | 2.1% | 1 / 3 | 0 | 0.000003 s |
| DeepSeek | 56 | 40.0% | 16.4% | 2 / 18 | 53 | 3.31 s |
| Clef | 68 | 48.6% | 100% | 69 / 107 | 0 | 0.86 s |

The embedding time measures selection from cached vectors; vector generation is excluded. Model times include the request and failed attempts in the final test records. DeepSeek p95 time is 5.21 s; Clef p95 is 0.98 s. Clef is 3.86 times faster by mean request time and incurs no hosted API charge.

| Reference class | DeepSeek correct | Clef correct |
| --- | ---: | ---: |
| Existing label, 54 cases | 35 | 38 |
| Genuine `none_fit`, 86 cases | 21 | 30 |

Clef wrongly selects an existing label on 56 of the 86 `none_fit` cases. Its 69 wrong accepted reuses include those 56 cases and 13 wrong-label selections on positive cases. The development-selected threshold of zero accepts every Clef decision.

DeepSeek's 53 failed test calls consumed all 1024 output tokens on reasoning and produced no valid answer. They were retained without test retries or parameter changes. This measures DeepSeek under the frozen output limit, rather than its quality with a larger budget. Among the 87 cases where DeepSeek returned a valid answer, DeepSeek got 56 right and Clef got 51 right. That subset is descriptive and excludes failures; the full test remains the primary result.

Clef's full-test accuracy exceeds DeepSeek by 8.57 percentage points. The grouped paired bootstrap 95% interval is 0.00 to 17.86 points. On the shared valid subset the interval is -15.73 to +4.49 points. Neither comparison establishes a general quality advantage.

### Gates and spending

| Gate | Result | Evidence |
| --- | --- | --- |
| L-G1: at least 10 percentage points above strongest control | FAIL | Clef 48.6% versus normalisation 60.7%, a 12.14-point loss |
| L-G2: wrong accepted reuse below 2% | FAIL | 69 / 107, or 64.49% |
| L-G3: accepted coverage at least 70% | PASS | 140 / 140 |
| L-G4: valid reviewed evaluation | INCONCLUSIVE | AI reference has no independent human review |
| L-G5: preserve production data | PASS | No production writes, entry merges, description edits or section moves |

Total hosted usage cost is **US$0.1882824**, within the approved US$5 cap. All **264 hosted attempts** reconcile with saved usage: 260 final matched records, two calls from the abandoned small-batch run and two development failures before retry. The generic summary counts four tickets outside the final matched records as `unlinked_reservations`; `comparison.json` links all four to retained attempt records. Their US$0.0036426 is known usage, with no unresolved cost.

**Decision:** keep the current production label-selection path. Clef is faster under these settings but its rejection behaviour and wrong-reuse rate fail the frozen gates. The overall verdict remains INCONCLUSIVE because the answer key is AI-authored.

## Current preparation status

The original AI draft remains unchanged in `corpus/`. It labelled all 140 test observations as `none_fit` and left eight compound observations unresolved. The user approved revising a copy and stopping before inference.

The revised reference is in `output/revision-01/corpus/`. Its 140 test cases contain **54 existing-label matches and 86 genuine `none_fit` decisions**. All eight boundary cases have explicit AI adjudications. Mechanical validation passed, including development-only catalogue provenance and source-field preservation.

Real vectors, candidate lists and inference manifests are saved in the canonical run. The reference retains `human_reviewed: false` and supports an AI-reference diagnostic with an INCONCLUSIVE overall verdict.

## Approvals and scope

- Date: 2026-10-10.
- Worktree: `omms-feat-evaluate-memory-decision-models`.
- Branch: `feat/evaluate-memory-decision-models`; starting commit `d22b578`.
- Scope: OpenSpec `evaluate-memory-decision-models`, groups 2 and 5 only.
- The user approved AI reference labels. Their author also saw the original draft and source categories; the reference is not independent human ground truth. `human_reviewed` remains `false`.
- Approved preparation: read-only snapshot of the active profile, with redacted observations in ignored experiment-local files.
- Approved hosted transfer: selected redacted observations and the catalogue to DeepSeek.
- Approved spending cap: US$5. Hosted attempts: **264**. Hosted usage cost: **US$0.1882824**.
- The user approved the existing `L-G1` through `L-G5` gates. Human-review validity remains INCONCLUSIVE.
- Jev, Julia and OpenJev are excluded from this requested DeepSeek-versus-Clef comparison.

## Preparation results

| Check | Result |
| --- | --- |
| Selected observations | 200 |
| Development | 60: 30 preferences, 30 patterns |
| Test | 140: 70 preferences, 70 patterns |
| Revised catalogue | 41 labels: 22 preferences, 19 patterns |
| Source ID, section, category and description preserved | PASS |
| Selected IDs complete and unique | PASS |
| Declared groups confined to one split | PASS |
| Catalogue aliases drawn only from development categories | PASS |
| Positive existing-label outcomes in test | 54: 26 preferences, 28 patterns |
| `none_fit` outcomes in test | 86: 44 preferences, 42 patterns |
| Catalogue IDs with positive test evidence | 26: 14 preference IDs, 12 pattern IDs |
| Old boundary cases adjudicated | 8 |
| Unresolved cases | 0 |
| Source cases replaced | 0 |
| Development/test model inference | COMPLETE: 920 / 920 records, including failures |
| Frozen inference manifest | Saved and verified before test calls |
| Real-data summary metrics | Reproduced by read-only analysis |
| Mocked end-to-end reproduction | PASS: 920 synthetic records |

The revision distinguishes reusable category labels from near-equivalent intents. Different substantive behaviours may share a category across splits. Paraphrases, translations and near-equivalent requested actions remain in whole groups, including cross-section groups. `grouping-audit.json` documents those decisions. Source wording, IDs, categories and sections are unchanged for all 200 observations.

The revised notes record definite primary-intent decisions for the eight old boundary cases. The ambiguous alias `Pragmatism` was removed from both `pattern_gated_workflow` and `pattern_proportionate_process`; spelling alone cannot distinguish them. The definitions and expected outcomes were retained.

Development has 60 positive cases and no `none_fit` examples. Threshold tuning therefore had no evidence for rejection behaviour. Several catalogue labels lack positive test examples. Semantic group separation rests on AI judgement; mechanical checks cannot establish human agreement. The 86 rejection cases make an always-`none_fit` answer correct on 61.4% of test cases. That diagnostic exceeds every tested arm's raw accuracy.

## Runtime checks

The pinned Clef weights and server binary match Experiment 03's checksums:

- Model: `Clef-Flash-Q8_0.gguf`, alias `clef-flash`.
- Weights SHA-256: `d7c352faf1bdd9ea24d0b9347e8eb1eb4bbadeff6c02383bf750215a74f2f1f1`.
- Server: llama.cpp build `11510`, commit `c35b66744`.
- Server SHA-256: `1bf5602a2be50097c44282a6ecc63234d94ee8f96d39fd45fed6eff4e74b6b41`.
- Endpoint: loopback `127.0.0.1:3002`, offline, logging disabled, one slot.
- Physical batch and microbatch: 8192; context: 8192 tokens. Runtime arguments and served model path match the saved manifest. Test calls were warmed by 120 development native calls.

Qwen3 embedding, 0.6B Q8_0, ran locally at `127.0.0.1:9931`. Its weight checksum was verified during preparation. Vectors are pinned in the checkpoint; matched 16-label shortlists plus `none_fit` were frozen before inference. The largest request payload was 4412 bytes, below the 8192-byte guard.

## Implementation and tests

Experiment-local code covers catalogue validation, matched shortlists, model parsing, checkpoints, development-only threshold tuning, spending reservations and the label gates. A fully mocked end-to-end run passed through vector preparation, 360 development records, resume without repeat calls, a frozen threshold manifest, 560 test records and read-only analysis verification.

Run:

```bash
uv run --project experiments --no-sync pytest \
  experiments/01-label-decisions-2026-10-07/test_labels.py \
  experiments/01-label-decisions-2026-10-07/test_preflight.py -q
```

Result: **29 passed**. Implementation-removal checks cover all 27 test functions, including the three gate-boundary parameter cases. Each targeted test failed when its implementation was removed in a disposable experiment-local copy. Proof records are in `output/revision-01/mutation-proof.json`. Synthetic end-to-end artefacts are separately marked under `output/synthetic-script-check-*` and contain no real model results.

The guards reject unresolved annotations, rejection-only test sets, insufficient section catalogues, altered source fields, leaked groups or identical intents, test-only aliases, missing call approval, changed checkpoints and forged development freezes. Requests reject input overflow and unapproved model parameters before transfer. Reservations precede hosted calls, parsing failures retain usage charges, and timeouts keep their reservations. Lift gates use exact case counts.

CLI writes require a revision root beneath this experiment's `output/`. The original corpus path is rejected. Vector preparation leaves calls disabled unless explicitly approved. Tasks **2.1–2.4 and 5.1–5.5** are complete for the approved AI-reference pilot. Task 2.5 remains unchecked because the original planning protocol was not edited. Human review is still outstanding and no production promotion follows.

The actual revised reference passed this zero-call command:

```bash
uv run --project experiments --no-sync python \
  experiments/01-label-decisions-2026-10-07/build_inputs.py \
  --root experiments/01-label-decisions-2026-10-07/output/revision-01 \
  --check-only
```

`output/revision-01/preflight-summary.json` records verified counts and preservation checks. OpenSpec strict validation and `git diff --check` pass.

The scanner's latest attempt covered nine Python files and failed on the incompatible OpenGrep rule option `taint_intrafile`. The user asked to proceed without scanner repair. No scanner setting was changed and no package was installed. Security scanning remains **BLOCKED**, with no clean-scan claim.

## Experiment 03 preservation

All **97 protected files** match their revision-start hashes: the eight original corpus files plus Experiment 03's saved artefacts and the shared experiment Python files. The copy's annotation input, source pool, source provenance and database snapshot also retain their original hashes.

The requested verification commands passed after preparation:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/run_clef.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json \
  --verify

uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/analysis.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/ai-pilot-test-recovery-manifest.json \
  --verify
```

- Clef verification: metrics reproduced; **285/285** records complete.
- Hosted-pilot analysis: metrics reproduced; **1,353/1,353** required records accounted for.
- Both verification commands made zero hosted calls.

`git diff` still lists Experiment 03's `protocol.md`, which was already modified at session start. Its hash is unchanged by this session. The shared protected helpers have no tracked diff; their existing untracked status is also preserved. No protected file was edited by this work.

## Evidence and reproduction

Canonical raw records, summary, manifests, attempt accounting and diagnostics are under `output/revision-01-batch8192/`. This directory is ignored to keep profile text out of git. The durable report is this file.

```bash
uv run --project experiments --no-sync python \
  experiments/01-label-decisions-2026-10-07/analysis.py \
  --root experiments/01-label-decisions-2026-10-07/output/revision-01-batch8192 \
  --verify
```

Verification reports reproduced metrics and a complete record set, with zero hosted calls. `comparison.json` provides the full paired comparison and reconciliation of all attempts. `failure-diagnostics.json` records token exhaustion and the shared valid subset. `freeze-proof-before-test.json` binds the development results and test manifest.

## Follow-up options

1. Keep production unchanged because the frozen quality and wrong-reuse gates failed.
2. If another pilot is wanted, approve a separate development set with genuine rejection examples and a larger DeepSeek output allowance.
3. Obtain human reference review before claiming an independent PASS verdict.

Human review is still required for an independent PASS verdict. No commits, pushes, production writes, file deletions or package installs were performed.
