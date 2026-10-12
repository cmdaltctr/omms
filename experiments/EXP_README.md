# OMMS experiments

Experiments test proposed changes against reviewed data before production behaviour changes. Each experiment has its own dated folder and a complete `protocol.md`.

| ID  | Question                                                                   | Status  | Protocol                                                             | Report             |
| --- | -------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ------------------ |
| 01  | Can bounded decisions reuse profile categories safely?                     | PLANNED | [Label decisions](01-label-decisions-2026-10-07/protocol.md)         | Pending evaluation |
| 02  | Can decisions select more useful memory and profile context?               | PLANNED | [Retrieval decisions](02-retrieval-decisions-2026-10-07/protocol.md) | Pending evaluation |
| 03  | Can a decision model make duplicate and conflict checks safely and faster? | PLANNED | [Pair decisions](03-pair-decisions-2026-10-10/protocol.md)           | Pending evaluation |

All three experiments belong to the [evaluate-memory-decision-models proposal](../openspec/changes/evaluate-memory-decision-models/proposal.md). One change covers their evaluation setup. Results are judged separately.

## Approval and run status

The human-reviewed evaluations remain planned. Shared tooling and a profile snapshot now exist. Experiment 03 also has a separately approved AI-labelled diagnostic pilot, described below.

1. Approve the OpenSpec proposal before implementation.
2. Approve installations and model downloads before setup.
3. Review ground truth and freeze the controls before inference.
4. Approve hosted data transfer and a spending limit before hosted calls.

Mark a protocol READY TO RUN only after its prerequisites and approvals are complete. Use ACTIVE during evaluation. Finish with PASS, FAIL or INCONCLUSIVE, and record the reason in `report.md`.

A result supports a later production proposal. It cannot authorise a production change.

## Files and data

- Commit protocols, runner code, analysis code and reviewed synthetic fixtures.
- Keep profile snapshots, real queries, ground truth, raw results and model weights in ignored local paths.
- Create ignore rules before exporting data.
- Use metadata-only logs and redact `<private>` content and secrets before inference.
- Checkpoint under each experiment's `output/` directory, using `.tmp` followed by rename.
- Use `--resume` only when the saved manifest and evaluation settings match.
- Keep one human-readable results document per experiment: `report.md`.
- Generate `analysis.py` from local JSON after results exist. Keep generated notebooks ignored.

## Scope

The pilot compares the current language model, Jev and Julia-1 against simpler controls. OpenJev is optional until its exact repository and backend are selected.

The experiments leave production stores, host sessions and live configuration unchanged. Profile translation, performing entry merges, Jev integration and coloured category badges need separate changes.

## Implemented shared tooling

Use the existing Python 3.11 or later. Obtain installation approval before setup:

```bash
UV_PYTHON_DOWNLOADS=never uv sync --project experiments --python python3.11
uv run --project experiments --no-sync python -m pytest experiments/tests/test_setup.py
```

After separate snapshot approval, run the read-only copy command. Replace the source and target with the approved paths:

```bash
uv run --project experiments --no-sync python experiments/tooling.py snapshot \
  --source /approved/source.db \
  --target experiments/03-pair-decisions-2026-10-10/corpus/snapshot.db \
  --root experiments/03-pair-decisions-2026-10-10 --snapshot-approved
```

The Unix SQLite command uses `mode=ro`, `readonly_shm=1` and normal locking. Missing shared memory fails without creating source sidecars. Empty shared memory and linked paths are refused. Pin the tested SQLite executable before real-data preparation. The raw copy remains private and ignored. Redact exported text before corpus generation.

Check the frozen manifest before inference. This command makes no model calls:

```bash
uv run --project experiments --no-sync python experiments/tooling.py validate \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/manifest.json \
  --hosted-arm P1 --hosted-arm P2
```

Validation requires reviewed ground truth, both grouped splits, matching file hashes, model pins, frozen settings and explicit call approval. Hosted approval must name the corpus hash and include a spending limit. Preparation manifests remain invalid for inference until these fields are complete.

Verify checkpoint and resume with synthetic metadata only:

```bash
uv run --project experiments --no-sync python experiments/tooling.py resume-probe \
  --root experiments/03-pair-decisions-2026-10-10/output/probe
uv run --project experiments --no-sync python experiments/tooling.py resume-probe \
  --root experiments/03-pair-decisions-2026-10-10/output/probe --resume
```

The first command records one result. The second records none. Existing results require `--resume`; changed fingerprints are refused. Failed records remain stored and require an explicit retry. Each write flushes a `.tmp` file before atomic replacement.

The snapshot and resume commands are tested against temporary synthetic data in `experiments/tests/test_tooling.py`. The human-reviewed pair benchmark still requires independent review and complete approvals.

## Experiment 03: human-reviewed benchmark (corpus v2)

The reviewed benchmark enriches the approved reduced selection with likely positives before blind review. `prepare_v2.py` keeps all 213 original pairs and splits unchanged, adds every unused duplicate candidate at cosine 0.75 or above, and refuses snapshot drift, changed original pairs and fresh conflict candidates. It makes no model calls and holds every inference approval false in `corpus/manifest-v2.json`.

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/prepare_v2.py \
  --root experiments/03-pair-decisions-2026-10-10
```

The result is 282 blind review pairs (129 development and 105 test duplicate pairs; 12 and 36 conflict pairs). The reviewer labels them in the generated local page, which shows descriptions only:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/build_review_page.py \
  --review experiments/03-pair-decisions-2026-10-10/corpus/blind-review-v2.json \
  --out experiments/03-pair-decisions-2026-10-10/corpus/review.html
```

Validate the exported labels before any inference. The validator rejects incomplete outcomes, changed text, smuggled scores or model answers, and private content:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/validate_review.py \
  --review experiments/03-pair-decisions-2026-10-10/corpus/blind-review-v2.json \
  --file review-export.json
```

The synthetic tests in `experiments/tests/test_prepare_v2.py` and `experiments/tests/test_review_tooling.py` cover the enrichment guards and the review validation. Inference waits for the reviewed ground truth and the transfer and spending approvals.

Each review page keeps its progress under its own browser key (`omms-blind-review-progress:<corpus hash>`), so the two pages can share one browser.

On 2026-10-10 the user chose AI labels instead of a human review. `corpus/ai-review-export.json` and `corpus/ai-challenge-export.json` hold them, and `corpus/ai-review-provenance.json` records `human_reviewed: false`. They are a diagnostic reference only. `approvals.review` stays false and merge-safety verdicts stay INCONCLUSIVE. The AI labels give 10 `same` duplicates and zero contradictions in the test split, too few for the false-merge bound in `P-G1` to pass.

#### AI-labelled diagnostic on corpus v2

The user approved a diagnostic run against the AI labels on 2026-10-10, with a US$5 cap on a fresh ledger. It runs `P0` embeddings, `P1` DeepSeek and local Clef on the production pairs and the challenge set. Jev and the hybrid are withheld. `experiments/review_pilot.py` refuses any other arm before a call. It imports the frozen pilot helpers and does not change them, so earlier results still reproduce.

```bash
D=experiments/03-pair-decisions-2026-10-10
uv run --project experiments --no-sync python $D/run_review_pilot.py \
  --manifest $D/corpus/review-pilot-manifest.json --prepare --spend-usd 5
uv run --project experiments --no-sync python -u $D/run_review_pilot.py \
  --manifest $D/corpus/review-pilot-manifest.json --split development --resume
uv run --project experiments --no-sync python -u $D/run_review_pilot.py \
  --manifest $D/corpus/review-pilot-test-manifest.json --split test --resume
uv run --project experiments --no-sync python -u $D/run_review_pilot.py \
  --manifest $D/corpus/review-pilot-test-manifest.json --split challenge --resume
uv run --project experiments --no-sync python $D/run_review_pilot.py \
  --manifest $D/corpus/review-pilot-test-manifest.json --verify
```

The development run picks the embedding and Clef cut-offs from development cells only, then writes the frozen test manifest. The test and challenge runs refuse to start without it. Clef needs the pinned llama.cpp server on `127.0.0.1:3002`. Results, the ledger and `report.md` stay under the ignored `output/review-pilot/` directory. The synthetic tests in `experiments/tests/test_review_pilot.py` cover the arm guard, the freeze, the spending stop and the summary.

Result (2026-10-10): 1,791 of 1,791 records, 1,006 DeepSeek calls, 503 Clef calls, zero Jev or hybrid calls, US$0.29 accounted. Merge safety is INCONCLUSIVE. Frozen cut-offs: embeddings 0.9, Clef 0.9 for duplicates and 0.5 for conflicts. On the challenge set Clef made no wrong YES and found 18 of 20 duplicates and 24 of 24 contradictions, at about 5x DeepSeek's speed. On production test duplicates Clef said YES twice, both on pairs labelled `uncertain`, and found none of the 10 labelled `same`. DeepSeek found 4 of them. `rescore_clef.py` adds an unfrozen extra table to `report.md` from the saved probabilities, with no model calls. At a cut-off of 0.8 Clef finds 4 of the 10 with no wrong YES; the frozen 0.9 cut-off causes the miss. `--verify` reproduces every metric but refuses on the spending total, which differs by 4×10⁻¹⁶ USD. The ledger file stores its keys sorted, so the reloaded sum adds in a different order. Round that total in the summariser before the next run; the pinned code stays unchanged for this run.

### Supplemental challenge cases

The user approved 80 clearly-marked synthetic cases because the snapshot holds no conflict positives. They are reviewed blind in their own page and reported as a separate diagnostic outside the production-band gates:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/challenge_cases.py \
  --root experiments/03-pair-decisions-2026-10-10
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/build_review_page.py \
  --review experiments/03-pair-decisions-2026-10-10/corpus/challenge-blind-review.json \
  --out experiments/03-pair-decisions-2026-10-10/corpus/challenge-review.html
```

Intended outcomes stay in `corpus/challenge-design.json`, away from the review page. The synthetic tests in `experiments/tests/test_challenge_cases.py` verify the approved shape, unique ids and blindness.

## Experiment 03: AI-labelled diagnostic pilot

The user approved using AI-generated draft labels for an early comparison. This pilot measures agreement, latency and usage costs. Merge safety remains INCONCLUSIVE. It leaves the original human-review manifest and benchmark unchanged.

Keep the AI-reference provenance, corpus checksums, model pins, code hashes and explicit transfer and spending approvals in a separate local manifest. Both providers share one spending ledger. Unknown usage retains a worst-case reservation; provider failures receive no automatic retry.

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/run_ai_pilot.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/ai-pilot-development-manifest.json \
  --split development --resume
```

Development completion saves `corpus/ai-pilot-test-manifest.json` before test inference. Questions stay fixed. Thresholds and the fallback band use development records only. Run the same command with that test manifest and `--split test --resume`.

Results, checkpoints, the shared ledger and `report.md` stay under the ignored `output/ai-pilot/` directory. The read-only analysis command makes no model calls:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/analysis.py
```

The focused synthetic tests in `experiments/tests/test_ai_pilot.py` exercise both CLI phases, approval failures, spending limits, interruptions and the separation from human ground truth.

### Standalone local Clef comparison

The user separately approved Clef Flash Q8_0 through an existing llama.cpp b11510 server. This add-on reuses the frozen pairs and questions. It calls only loopback, disables proxies and redirects, and sends one Noul question at a time. It has no hybrid fallback or hosted spending.

The local development manifest pins the existing GGUF, server executable, launch flags, hardware, code and original pilot artefacts. It also records local inference approval. Start the pinned server separately on `127.0.0.1:3002` with offline mode and logging disabled. The runner checks its served model path before sending pair descriptions.

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/run_clef.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/clef-development-manifest.json \
  --split development
```

Development includes A/B swaps. Clef's cutoff uses the original development-only threshold grid, without copying Jev's cutoff. Completion saves `corpus/clef-test-manifest.json` before test inference. Run the command again with that manifest and `--split test`. Existing checkpoints require `--resume`; failed records are retried only with explicit `--retry-failed` approval.

Clef's raw results and checkpoints stay under ignored `output/clef/`. The existing hosted results, manifests and spending ledger stay unchanged. Add Clef's column to the existing `output/ai-pilot/report.md` after checking the metrics. There is no additional results report.

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/run_clef.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json \
  --verify
```

Verification reproduces the saved metrics without making HTTP calls or writing files. The synthetic tests in `experiments/tests/test_clef_pilot.py` cover the documented commands, local-only requests, frozen evidence, invalid probabilities, resume and development-only tuning. Local inference has no API charge; hardware and electricity costs are not measured. AI-reference merge safety remains INCONCLUSIVE.

### Recover an interrupted response

An incomplete HTTP response becomes a transport error. Its unknown usage retains the full reservation. Resume skips that failed record.

The first pilot stopped before this error handling existed. The user separately approved a transport-only recovery. Its helper verifies the exact patch, preserves the original checkpoint and records both code versions. It refuses changes to other code or ambiguous reservations. Questions, thresholds and the shared spending ledger stay unchanged.

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/recover_ai_pilot.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/ai-pilot-test-manifest.json \
  --approve-transport-recovery
```

This is a one-off recovery command. Obtain separate approval before using it. Resume with `corpus/ai-pilot-test-recovery-manifest.json`, `--split test` and `--resume`. The interrupted call remains an error with unknown timing; it is never silently retried.

Verify the saved summary against the raw records and ledger without making calls or changing files:

```bash
uv run --project experiments --no-sync python \
  experiments/03-pair-decisions-2026-10-10/analysis.py --verify \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/ai-pilot-test-recovery-manifest.json
```

## Retrieval: Experiment 04 (alias Experiment 1a)

| ID      | Category  | Size  | Question                                                                                                              | Status       | Plan and report                                                                  |
| ------- | --------- | ----- | --------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| 04 (1a) | retrieval | Quick | Can acceptance-threshold calibration reduce Clef's wrong existing-label reuse while retaining useful correct matches? | INCONCLUSIVE | [Clef label thresholds](04-retrieval-clef-label-thresholds-2026-10-10/report.md) |

This follow-up completed post-hoc rescoring of saved Experiment 01 Clef probabilities.
It made no new inference calls or model restarts.
AI-reference labels leave final validity INCONCLUSIVE.

The user approved implementation and the retention guard of 19 correct accepted existing labels on 2026-10-10.
No listed threshold meets both gates. At 0.8, 21 correct matches remain with 16% wrong reuse.
At 0.95, wrong reuse falls to zero while only three correct matches remain.
Source: [Experiment 04 summary](04-retrieval-clef-label-thresholds-2026-10-10/output/summary.json).
Results can guide later independent evaluation; production approval remains outside scope.

## Retrieval: Experiment 05 (alias Experiment 1b)

| ID      | Category  | Size  | Question                                                                                               | Status       | Plan and report                                                                |
| ------- | --------- | ----- | ------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------ |
| 05 (1b) | retrieval | Quick | Can Qwen3-0.6B reuse existing labels safely while retaining useful correct matches compared with Clef? | INCONCLUSIVE | [Qwen label decisions](05-retrieval-qwen-label-decisions-2026-10-10/report.md) |

This pilot completed local Qwen3-0.6B Q8_0 inference against saved Clef answers, with earlier experiments unchanged.
Source: Experiment 05 `output/summary.json`. All 140 cases completed; 21 correct existing-label matches passed the coverage gate.
Wrong reuse was 44/65, or 67.7%, which failed the safety gate. Functional verdict: FAIL.
Overall accuracy improved from 48.6% to 55.7%, through more correct `none_fit` answers.
Validity remains INCONCLUSIVE. Production settings remain unchanged; no fresh Clef calls were made.

## Retrieval: planned follow-ups 06 and 07

| ID  | Category  | Size  | Question                                                                                                 | Status       | Plan and report                                                                              |
| --- | --------- | ----- | -------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| 06  | retrieval | Quick | Can a primary-intent instruction help Qwen meet the fixed label-reuse gates?                             | INCONCLUSIVE | [Primary-intent selection](06-retrieval-primary-intent-label-selection-2026-10-10/report.md) |
| 07  | retrieval | Quick | Can scoped exact reuse honour approvals and corrections while preserving classifier responses on misses? | INCONCLUSIVE | [Scoped assignment reuse](07-retrieval-scoped-assignment-reuse-2026-10-10/report.md)         |

The user selected Quick scope for both experiments. These plans await implementation and execution approval.
Experiment 06 changes one instruction against saved Experiment 05 Qwen answers.
Experiment 07 independently replays verified assignment events offline against that same frozen classifier baseline.
Keep synthetic replay outcomes separate from the 140-case label-accuracy score.
Neither plan authorises production changes or new inference calls.

The user subsequently approved implementation and execution of both experiments.
Experiment 07 completed its offline replay: functional PASS, with real-world validity INCONCLUSIVE.
All 48 synthetic queries matched expected routing; eight correction hits honoured precedence.
The 140 original responses stayed unchanged. Source: Experiment 07 `output/summary.json`.

Experiment 06 also completed in its parallel session: functional FAIL, with reference validity INCONCLUSIVE.
Fresh Qwen calls with the primary-intent instruction produced 23 correct and 48 wrong existing-label choices.
Overall accuracy fell from 78/140 to 72/140; wrong reuse remained about 67.6%.
Source: Experiment 06 `output/summary.json`. Read-only reproduction and ten focused tests passed on 2026-10-11.
The completed run was verified without repeating inference or replacing its outputs.

## Retrieval: Experiment 08, delegated draft replay

| ID  | Category  | Size  | Question                                                                                               | Status       | Plan and report                                                                           |
| --- | --------- | ----- | ------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- |
| 08  | retrieval | Quick | Can scoped exact lookup reuse eligible AI drafts while preserving saved classifier outcomes on misses? | INCONCLUSIVE | [AI-drafted assignment replay](08-retrieval-draft-assignment-replay-2026-10-11/report.md) |

The user authorised drafting labels and completing this small offline follow-up without further questions.
Assignments remain AI-drafted and lack individual human adjudication.
The replay uses saved Experiment 05 responses and preserves Experiments 01–07.

Completed: functional PASS across 30 queries, with three eligible draft hits and 27 preserved fallbacks.
All ten unseen-observation responses stayed unchanged. Seven seed drafts lacked a suitable existing label and remained uncached.
Classification validity remains INCONCLUSIVE; the assignments were AI-drafted rather than independently reviewed.
Source: Experiment 08 `output/summary.json`.

## Retrieval: Experiment 09, verification gate before first label reuse

| ID  | Category  | Size     | Question                                                                                                                                           | Status                                       | Plan and report                                                              |
| --- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| 09  | retrieval | Standard | Can a calibrated binary verification gate on the classifier's chosen label bring wrong reuse below 2% while retaining at least 19 correct matches? | INCONCLUSIVE (AI reference); functional FAIL | [Verify label reuse](09-retrieval-verify-label-reuse-2026-10-11/protocol.md) |

Completed on 2026-10-11. Both verifier arms (NLI ONNX, Clef yes/no) failed the frozen calibration rule on the development split, so neither ran on the test cases and no test inference occurred. The decision rule says stop; do not propose another prompt or model change from this evidence. Report: [09 report](09-retrieval-verify-label-reuse-2026-10-11/report.md).

## Review: Experiment 10, blind adjudication of the reference labels

| ID  | Category | Size     | Question                                                                                                                                                | Status                      | Plan and report                                                                 |
| --- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| 10  | review   | Standard | How often do the AI-authored reference labels disagree with blind human adjudication, and does the Experiment 06 verdict change on the human reference? | COMPLETE — reference frozen | [Adjudicate reference](10-review-reference-adjudication-2026-10-11/protocol.md) |

Completed on 2026-10-11. An independent draft, a blind second-agent judge and a reconsideration round produced a two-agent consensus; the operator arbitrated the 10 remaining disputes and accepted the 130 consensus cases wholesale (recorded as batch confirmation). The frozen reference disagrees with the old AI reference on 22 of 140 cases (15.7%), mostly turning over-conservative `none_fit` into labels. Experiment 06 re-scored on it: 29 of 71 picks correct, wrong reuse 59.15% — the FAIL verdict stands. Report: [10 report](10-review-reference-adjudication-2026-10-11/report.md).
The gate verifies each of the 71 saved Experiment 06 existing-label picks once; `none_fit` answers pass through unchanged.
Two arms share the frozen baseline: an NLI cross-encoder (`cross-encoder/nli-deberta-v3-small`, official int8 ARM64 ONNX) and the Experiment 03-pinned Clef model answering yes or no.
Both thresholds are calibrated on the 60 development cases, then frozen before test inference.
Planning authorises no installs, downloads or inference. Cached-repeat routing from Experiments 07 and 08 stays out of scope.

## Retrieval: Experiment 11, catalogue consolidation replay and the new scoring ruler

| ID  | Category  | Size     | Question                                                                                                                                             | Status                      | Plan and report                                                                            |
| --- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| 11  | retrieval | Standard | How much of Experiment 06's wrong label reuse disappears when confusable labels merge into a smaller catalogue built from development evidence only? | FAIL (post-hoc exploratory) | [Consolidation replay](11-retrieval-catalogue-consolidation-replay-2026-10-11/protocol.md) |

Completed on 2026-10-11. FAIL: at 20 labels, 1 of 13 label-versus-label wrong picks became correct (7 needed); wrong reuse 57.75% to 56.34%. The 28 picks on `none_fit` cases cannot change by merging. Experiment 12 keeps 41 labels. Report: [11 report](11-retrieval-catalogue-consolidation-replay-2026-10-11/report.md).
Post-hoc exploratory: it replays the saved Experiment 06 answers through merge maps built from Experiment 09 development scores, with no model calls. It also freezes the scoring ruler for later experiments: acceptable-label sets, Tier 1 screening (zero wrong and at least 29 correct on the 140 cases) and Tier 2 production evidence (upper bound at most 5% on fresh data). The flat 2% gate is retired.

## Retrieval: Experiment 12, neighbour check against reviewed members

| ID  | Category  | Size     | Question                                                                                                                                                       | Status                  | Plan and report                                                            |
| --- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| 12  | retrieval | Standard | Can a gate that compares each observation with already-labelled observations reuse labels with zero wrong picks and at least 29 correct on the 140 test cases? | FAIL (safe but starved) | [Neighbour gate](12-retrieval-neighbour-reuse-gate-2026-10-11/protocol.md) |

Completed on 2026-10-11. FAIL: 1 correct, 0 wrong, 139 parked; all 28 forced-label errors parked. Exploratory: the nearest neighbour is acceptable for only 32 of 67 labelled cases, so the embeddings do not separate intent labels. Report: [12 report](12-retrieval-neighbour-reuse-gate-2026-10-11/report.md).
It used the cached Experiment 01 vectors, so it makes no model calls. Thresholds are chosen inside 5 group-based folds, never on the case being scored. The gate parks unsure cases and never writes `none_fit`. Review load is reported, not gated.

## Retrieval: Experiment 13, compare check with Clef

| ID  | Category  | Size     | Question                                                                                                                                                                         | Status              | Plan and report                                                         |
| --- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| 13  | retrieval | Standard | Does asking Clef to choose between the two closest labels, shown with their past examples, keep more correct matches than the neighbour gate alone, still with zero wrong picks? | WITHDRAWN (not run) | [Compare check](13-retrieval-compare-check-gate-2026-10-11/protocol.md) |

Withdrawn on 2026-10-11 without a run: Experiment 12 capped this design at 32 correct, and the operator chose review-first assignment ([ADR-024](../docs/adr/024-review-first-label-assignment.md)). The plan stays for the record. About 280 local Clef calls on an owned loopback server. The cut-off of 0.9 in both A/B orders is fixed before any call.

## Retrieval: Experiment 14, neighbour gate with 1 or 2 neighbours

| ID  | Category  | Size  | Question                                                                                                      | Status                      | Plan and report                                                                       |
| --- | --------- | ----- | ------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| 14  | retrieval | Quick | Does the Experiment 12 neighbour gate pass Tier 1 when it needs only 1 or 2 agreeing neighbours instead of 3? | FAIL (post-hoc exploratory) | [Fewer neighbours](14-retrieval-neighbour-gate-fewer-neighbours-2026-10-11/report.md) |

Completed on 2026-10-11. Reruns Experiment 12's frozen runner with k = 1 and k = 2, using the same fair fold method. Both accepted nothing: 0 correct, 0 wrong, 140 parked. With k = 1, no fold found a threshold with zero wrong picks among its training cases. The Experiment 12 conclusion stands.

## Retrieval: Experiment 15, Clef selects the intent label

| ID  | Category  | Size     | Question                                                                                                                                                                              | Status                  | Plan and report                                                              |
| --- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| 15  | retrieval | Standard | Can Clef, choosing among every same-section label with its definition and closest past examples, reuse labels with zero wrong picks and at least 29 correct, under two option orders? | FAIL (safe but starved) | [Clef intent select](15-retrieval-clef-intent-select-2026-10-11/protocol.md) |

Completed on 2026-10-11. FAIL: Clef never reached 0.9 confidence across 20 to 23 options, so nothing was accepted. Exploratory: the most confident wrong pick had 0.725, and only 9 correct picks sit above it. Clef recognised `none_fit` in 10 of 73 cases. Its scoring ignores option order, so the shuffle check tested nothing. Attempt 1 failed on the server batch size (amendment 1). Report: [15 report](15-retrieval-clef-intent-select-2026-10-11/report.md). Applies the literature review: select among candidates (ComEM), retrieved examples per option (KATE), order-shuffle consistency and abstention.

## Retrieval: Experiment 16, neighbour gate with the larger Qwen3 4B embedder

| ID  | Category  | Size  | Question                                                                                                        | Status                      | Plan and report                                                                |
| --- | --------- | ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| 16  | retrieval | Quick | Does Experiment 12's neighbour gate pass Tier 1 with `qwen3-embedding:4b`, plain or with an intent instruction? | FAIL (post-hoc exploratory) | [Qwen3 4B embedder](16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/report.md) |

Completed on 2026-10-11. FAIL: plain 4B accepted nothing; with the intent instruction it accepted 1 wrong pick. The instruction lifted nearest-neighbour accuracy from 32 to 41 of 67, the best embedding result, but forced labels on `none_fit` cases remain. Report: [16 report](16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/report.md).
It swaps only the embedder in Experiment 12's frozen gate, and records how often the nearest neighbour has an acceptable label (Experiment 12: 32 of 67). Uses the pinned llama.cpp server and a 4.28 GB Q8_0 GGUF download, approved by the operator.

## Retrieval: Experiment 17, reranker label suggestions for the review queue

| ID  | Category  | Size     | Question                                                                                                                                 | Status             | Plan and report                                                                        |
| --- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| 17  | retrieval | Standard | Does Qwen3-Reranker-0.6B put the right label first more often than cosine similarity, when suggesting a label for a reviewer to confirm? | PASS (weak margin) | [Reranker suggestions](17-retrieval-reranker-label-suggestions-2026-10-12/protocol.md) |

Completed on 2026-10-12. Route B (reranker scores label definitions) got 46 of 67 first suggestions right, meeting the target; cosine on the same shortlist got 44, so the gain is not significant (p = 0.85). Reranking past observations (Route A) did worse, 41. Exploratory: when reranker and cosine agree they are right 31 of 33 times, and showing both methods' suggestions puts the right label on screen for 60 of 67. Safety ceiling 13, so no automatic labelling. Report: [17 report](17-retrieval-reranker-label-suggestions-2026-10-12/report.md).
Measures suggestion quality for the review queue, not automatic labelling. Target: at least 46 of 67 first suggestions right (best cosine 41; Clef 49).

## Retrieval: Experiment 18, fresh-data confirmation of all methods together

| ID  | Category  | Size         | Question                                                                                                                                                      | Status                 | Plan and report                                                                          |
| --- | --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| 18  | retrieval | Confirmatory | Do the Experiment 17 findings hold on 400 fresh observations: three methods' picks together contain the right label, and their agreement marks a right label? | PASS (H1, H2); H4 FAIL | [Fresh confirmation](18-retrieval-fresh-confirmation-all-methods-2026-10-12/protocol.md) |

Completed on 2026-10-12. On 400 fresh observations (197 labelled, 195 no label, 8 disputed): the three methods' picks contain the right label for 169 of 197 (85.8%); all three agree on 62 and are right on 60 (96.8%), but also agree on 17 no-label cases, so automatic use fails (H4). First pick: Clef 141, cosine 105, reranker 102; the reranker equals cosine. Exploratory: Clef's own top three contains the right label for 186 of 197 (94.4%). Report: [18 report](18-retrieval-fresh-confirmation-all-methods-2026-10-12/report.md).
Preregistered in commit `571b393`, before selection, labelling or any model run. 400 fresh, privacy-filtered observations from the Experiment 01 snapshot; two blind AI labelling passes plus reconciliation; cosine, reranker and Clef run together with fixed combination rules (H1 to H4).

## Review: Experiment 19, catalogue version 2 candidates

| ID  | Category | Size  | Question                                                                                           | Status                    | Plan and report                                                                   |
| --- | -------- | ----- | -------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| 19  | review   | Quick | Do the 195 no-label observations from Experiment 18 group into a small set of coherent new labels? | FAIL (count rule, by one) | [Catalogue v2 candidates](19-review-catalogue-v2-candidates-2026-10-12/report.md) |

Completed on 2026-10-12. 147 of 195 no-label observations (75%) group into 26 candidate labels; the frozen limit was 25. Recommended: accept 15 distinct labels and hold 11 thin or overlapping ones. The operator decides. Catalogue version 2 must be tested on observations outside Experiment 18's 400.

## Retrieval: Experiment 20, catalogue version 2 on new observations

| ID  | Category  | Size     | Question                                                                                                                                                           | Status           | Plan and report                                                                  |
| --- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------- |
| 20  | retrieval | Standard | On 200 observations never used before, does catalogue version 2 leave fewer observations without a label, and does Clef's top three still contain the right label? | H1 PASS; H2 FAIL | [Catalogue v2 test](20-retrieval-catalogue-v2-fresh-test-2026-10-12/protocol.md) |

Completed on 2026-10-12. Under catalogue version 2, 64 of 192 scored observations (33.3%) fit no label, down from 49.7% under version 1: H1 holds. Clef's top three contains the right label for 112 of 128 (87.5%), under the 90% mark: H2 fails. Exploratory: five suggestions reach 91.4%. Adopt version 2; show five suggestions. Report: [20 report](20-retrieval-catalogue-v2-fresh-test-2026-10-12/report.md).
200 new privacy-filtered observations, outside Experiments 01 and 18. Targets fixed in advance: at most 35% with no label (Experiment 18 under version 1: 49.7%), and Clef's top three right for at least 90%.

## Retrieval: Experiment 21, final summary of Experiments 01 to 20

| ID  | Category  | Size  | Question                                              | Status   | Plan and report                                                  |
| --- | --------- | ----- | ----------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| 21  | retrieval | Quick | What do Experiments 01 to 20 mean for OMMS labelling? | COMPLETE | [Final summary](21-retrieval-final-summary-2026-10-12/report.md) |

Completed on 2026-10-12. OMMS cannot safely label new observations on its own yet. Adopt catalogue version 2, show Clef's five best guesses in the review queue, and keep review-first assignment (ADR-024).

## Retrieval: Experiment 22, confidence cut-off for up to three labels

| ID  | Category  | Size  | Question                                                                                                                | Status | Plan and report                                                         |
| --- | --------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 22  | retrieval | Quick | If OMMS tags each memory with up to three labels, can a confidence cut-off remove wrong tags without losing right ones? | FAIL   | [Tag cut-off check](22-retrieval-tag-cutoff-check-2026-10-12/report.md) |

Planned and completed 2026-10-12. Offline check on saved Clef probabilities from Experiments 18 and 20: choose the cut-off on Experiment 18, confirm on Experiment 20. No model calls. A new blind AI pass gave up to three valid labels per observation (Amendment 1). Cut-off 0.08, chosen on Experiment 18, lost 6 points of hits on Experiment 20: use plain top three. About 3 in 10 observations fit only a label from the other section, which Clef never sees. Report: [22 report](22-retrieval-tag-cutoff-check-2026-10-12/report.md).

## Retrieval: Experiment 23, all label methods, one section against both sections

| ID  | Category  | Size     | Question                                                                                                                 | Status | Plan and report                                                                           |
| --- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------- |
| 23  | retrieval | Standard | Which method gives the best three tags per memory, and does choosing from both sections (preferences and patterns) help? | MIXED  | [All methods, both sections](23-retrieval-all-methods-both-sections-2026-10-12/report.md) |

Planned 2026-10-12. Same 600 observations as Experiments 18 and 20, scored against the Experiment 22 multi-label key. Eight arms: cosine, reranker, Clef and their combination, each with one section and with both. Saved answers are reused; new local calls are about 800 reranker and 600 Clef. Targets: Clef gains at least 10 points with both sections and loses no more than 3 within a section; the best method wins unless a cheaper one is within 3 points.
