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
