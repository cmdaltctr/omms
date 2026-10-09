# Experiment 03: Profile duplicate and conflict decisions

- **ID**: `03-pair-decisions-2026-10-10`
- **Date planned**: 2026-10-10
- **Operator**: Dr Muhammad Aizat Bin Md Hawari with Claude Code
- **Status**: PLANNED (draft approved by the user on 2026-10-10; no runner, corpus or result exists)
- **Relation**: [evaluate-memory-decision-models](../../openspec/changes/evaluate-memory-decision-models/proposal.md), design decision 9 and tasks 7.1 to 7.7.

## Why this experiment exists

A profile-only OpenCode import makes many slow yes/no calls to DeepSeek. After four batches the logs showed 60 duplicate-check calls. Two production decisions make these calls:

| Decision  | Code                                                  | Question put to the model              | Pairs checked                                                    | Call cap per pass |
| --------- | ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| Duplicate | `checkSemanticDuplicate` in `user-profile-manager.ts` | Same behaviour, preference or pattern? | Same category, cosine similarity of 0.5 or more                  | 5                 |
| Conflict  | `checkConflict` in `user-profile-manager.ts`          | Are the two preferences contradictory? | Same category, cosine similarity from 0.65 up to (not incl.) 0.9 | 3                 |

A `true` answer merges the pair. The duplicate path adds the counts of the two entries and removes one. The conflict path does the same after lowering the keeper's confidence. A wrong `true` therefore destroys a distinct fact. A wrong `false` only keeps two entries.

Jev (`jev-1.13.0`) is the candidate for these checks. DeepSeek stays for extraction and description writing. This experiment measures whether Jev decides these pairs as safely as DeepSeek and how much time it saves. It does not integrate Jev.

## Hypothesis / Research question

Jev, alone or in a hybrid with DeepSeek, makes pair decisions with no more wrong merges than DeepSeek and a large reduction in decision time.

The hybrid uses Jev for pairs that clear a confidence band and sends the remaining pairs to DeepSeek.

## Background and prior evidence

- Production code: `detectConflicts`, `deduplicateItems`, `checkSemanticDuplicate` and `checkConflict` in `src/services/user-profile/user-profile-manager.ts`. Both checks time out after 30 seconds and treat any failure as `false`.
- The weak match band in `mergeItems` is embedding-only. It makes no model call and is out of scope.
- The conflict budget counted only positive answers until TDR-043. The cap now counts every attempted check.
- Category normalisation (TDR-041, TDR-042) merges spelling variants. Pair groups are larger after the live repair, so the snapshot for this experiment must be taken after the repair and the date recorded.
- Jev Noul returns a yes/no probability (<https://docs.typesafe.ai/primitives/noul>). No OMMS duplicate benchmark exists in the vendor documentation. One vendor cookbook reports a mean round trip of 111 ms for a 14-question rubric. That is a vendor example and not a forecast for OMMS.
- Jev costs about US$0.042 per million input tokens, with free output. Its privacy policy excludes training on inputs. It does not promise zero retention.
- The import logs hold sizes, identifiers and codes only. They contain no pair text, so they cannot supply pairs or labels. They can supply call counts and DeepSeek latency.

### Side finding (verified in code, not part of this experiment)

`deduplicateItems` builds its pair cache key as `[a, b].sort().join("||").substring(0, 100)`. When the first sorted description has about 98 characters or more, the key ignores the second description. After one `false` verdict, every other pair that shares that first description is skipped as already checked. The effect is lost duplicate detection, not a wrong merge. Record it as a separate TDR and fix after this experiment.

## Variables

| Type        | Variable         | Values / treatment                                                                  |
| ----------- | ---------------- | ----------------------------------------------------------------------------------- |
| Independent | Decision method  | Embedding threshold, DeepSeek (production), Jev Noul, hybrid; optional Julia-1      |
| Dependent   | False-merge rate | Wrong `yes` answers among all accepted `yes` answers                                |
| Dependent   | Agreement        | Correct answers among decided pairs, with `uncertain` reviewed pairs reported apart |
| Dependent   | Decision time    | Mean, P95 and total seconds per pair, and per 60-pair import batch                  |
| Controlled  | Pair set         | Same pairs, same A/B order and same redacted text for every arm                     |
| Controlled  | Candidate rules  | Production similarity bands and same-category rule, not tuned                       |
| Controlled  | Embeddings       | The pinned OMMS embedding model                                                     |
| Controlled  | Data split       | Pairs that share an entry stay in one split                                         |

## Corpus and ground truth

| Item              | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Source            | A consistent, read-only snapshot of the live profile after the category repair           |
| Local path        | `experiments/03-pair-decisions-2026-10-10/corpus/` (ignored)                             |
| Duplicate set     | 200 pairs: 60 development and 140 test                                                   |
| Conflict set      | 150 pairs: 45 development and 105 test, with at least 30 reviewed contradictions in test |
| Ground truth path | `corpus/ground-truth.json`                                                               |
| Manifest path     | `corpus/manifest.json`, with source and corpus hashes, split seed and approvals          |
| Symlinks          | Prohibited for source databases, corpus files and output paths                           |

The sizes are proposals. Approve or change them before review starts.

1. Build candidate pairs with the production rules: same category, then the duplicate band (cosine 0.5 or more) or the conflict band (0.65 up to 0.9).
2. Sample across the cosine range. Include close paraphrases, related-but-distinct facts and true contradictions. Contradictions are rare in real data, so search the conflict band for them and record how many pairs were scanned.
3. Treat entries that appear in several pairs as one group. A group stays within one split.
4. The user reviews each pair blind. The reviewer sees the two descriptions only. No model answer, score or similarity is shown.
5. Allowed review outcomes are `same`, `different` or `uncertain` for duplicates, and `contradict`, `compatible` or `uncertain` for conflicts. A reason is required for each.
6. `uncertain` pairs stay in the set. They count against automatic acceptance and do not count as correct or wrong.
7. Model answers, including DeepSeek's, cannot define ground truth. The production logs cannot define it either.

Strip `<private>` content and redact secrets before building corpus files. Preserve the remaining wording. Create ignore rules before export. Commit only the protocol, code and reviewed synthetic fixtures.

## Environment and prerequisites

| Requirement        | Version / value                                                                         |
| ------------------ | --------------------------------------------------------------------------------------- |
| OMMS source        | Record the exact commit. The category work is `63f6b32` on `fix/workflow-merge`         |
| Runtime            | Bun for fixtures; Python 3.11 or later with `uv`, scoped to `experiments/`              |
| DeepSeek control   | Pin the provider, model ID and request parameters. Reuse the exact production prompts   |
| Jev                | `jev-1.13.0`; verify availability and pin the returned model ID                         |
| Embedding model    | The configured OMMS model and preprocessing                                             |
| Julia-1 (optional) | Only if the pinned weights support a yes/no probability. Otherwise mark the arm BLOCKED |
| Credentials        | Environment or file references. Keep values out of manifests and logs                   |
| Run approval       | Separate approval for installs, downloads, hosted data transfer and a spending limit    |

Hosted calls send profile text to Jev. Use only approved redacted pairs. Estimate the spend before any call. At 350 pairs and a few hundred tokens each, the input is well under one million tokens, so the cost is cents. Record the estimate and the actual billed amount.

## Experimental design / cell matrix

| Run ID         | Purpose                  | Role      | Key settings                                                                       |
| -------------- | ------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `P0-embedding` | Cheap control            | Baseline  | Cosine threshold chosen on development pairs; no model call                        |
| `P1-deepseek`  | Production control       | Baseline  | Exact production prompt, temperature 0, 30 s timeout; two repeats to measure noise |
| `P2-jev-noul`  | Candidate                | Candidate | One Noul question per pair; wording and threshold fixed on development pairs       |
| `P3-hybrid`    | Candidate                | Candidate | Jev answers outside a probability band; DeepSeek answers inside it                 |
| `P4-julia`     | Optional local candidate | Candidate | Same question, pinned weights; BLOCKED without a documented yes/no output          |

Run each arm on both decisions. A and B are symmetric in meaning. Production orders a pair by similarity. Run a swapped-order check on development pairs and report any answer that flips. Do not change the primary test order after seeing test results.

Tune the Jev question wording, the decision threshold and the hybrid band on development pairs only. Freeze them, with a hash, before the test run. Keep raw Jev probabilities separate from any provider confidence field.

Stop before test inference if review, model pins, isolation, spending limit or approvals are incomplete. The optional arm can be BLOCKED without stopping the others.

## Metrics

### Primary metrics

- **False-merge rate**: pairs the arm answered `yes` that the reviewer marked `different` (duplicate) or `compatible` (conflict), divided by all `yes` answers.
- **Agreement**: correct answers divided by pairs with a decided reviewed outcome. A timeout, an invalid answer or a missing answer counts as wrong.
- **Decision time**: mean and P95 seconds per pair, and total seconds for 60 pairs (one import batch of duplicate checks). Record cold and warmed calls separately.

### Diagnostic metrics

- Missed merges: reviewed `same` or `contradict` pairs the arm answered `no`.
- Hybrid fallback rate: share of pairs sent to DeepSeek.
- Calibration of Jev probabilities against reviewed outcomes.
- Self-consistency of `P1-deepseek` between its two repeats.
- Swapped-order flips.
- Results by cosine band and by case type (paraphrase, related-but-distinct, contradiction).
- Input tokens, billed cost, timeouts and error codes.
- Paired difference in agreement against `P1-deepseek` with a 95% confidence interval, resampling entry groups.

A zero denominator makes a rate undefined. Mark that gate INCONCLUSIVE. A small accepted sample cannot prove a production error rate. State the width of each interval.

## Procedure / reproduction commands

These commands describe the planned runner. The scripts and corpus do not exist yet. Build them only after approval of the OpenSpec update.

### Step 1: Prepare data

1. Verify the worktree and branch. Add ignore rules for corpus, output, weights and notebooks.
2. Open the source database read-only and take a consistent snapshot. Record the snapshot date and item counts.
3. Redact the snapshot, generate candidate pairs, and give the user the blind review file.
4. Write ground truth and a checksummed manifest.

### Step 2: Run evaluation

```bash
PYTHONUNBUFFERED=1 uv run --project experiments python -u \
  experiments/03-pair-decisions-2026-10-10/run_eval.py \
  --manifest experiments/03-pair-decisions-2026-10-10/corpus/manifest.json \
  --split development --resume
```

Freeze the development settings, then run the same command with `--split test`.

Write an atomic checkpoint after each pair and arm (`.tmp`, then rename). Flush progress output. Resume only when manifest, model, question, split and threshold hashes match. Keep failed pairs as errors and retry them explicitly.

### Step 3: Summarise raw results

```bash
uv run --project experiments python \
  experiments/03-pair-decisions-2026-10-10/summarise_eval.py
```

Write raw JSON and one `report.md`. List blocked arms, missing calls and confidence intervals. Generate `analysis.py` from local results. It must make no model calls.

## Success criteria / pass gates

These are proposed gates. Approve and freeze them before inference. Judge each candidate on each decision separately.

| Criterion                     | Threshold                                                                                    | Why it matters                               |
| ----------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `P-G1` False-merge rate       | Not above `P1-deepseek`, and the 95% upper bound below 5% of accepted `yes` answers          | Wrong merges destroy facts                   |
| `P-G2` Agreement              | Within 3 points of `P1-deepseek` or higher                                                   | Keeps decision quality                       |
| `P-G3` Time saved             | At least 5 times lower mean seconds per pair than `P1-deepseek` (hybrid: including fallback) | Addresses the import slowdown                |
| `P-G4` Fallback rate (hybrid) | At most 30% of pairs                                                                         | A hybrid that defers most pairs saves little |
| `P-G5` Validity               | Reviewed sets complete; frozen controls; no split leakage; all test cells accounted for      | Makes the comparison checkable               |
| `P-G6` Safety                 | Zero production writes, merges or profile edits                                              | Restricts the work to decisions on copies    |

The 5 times and 30% limits are placeholders for the user to set. The conflict set may lack enough contradictions for `P-G1`. In that case report INCONCLUSIVE for conflicts only.

## Interpretation rules

- PASS needs every gate for that candidate and decision.
- A PASS supports a later integration proposal. It does not integrate Jev, change the import, or enable automatic merging.
- FAIL means a complete, valid run missed a quality gate. Keep the current DeepSeek behaviour.
- INCONCLUSIVE means missing evidence, undefined rates or too few reviewed positives.
- If `P1-deepseek` repeats disagree often, report that first. The control itself is noisy.
- If `P0-embedding` already matches DeepSeek on agreement and false merges, recommend a threshold change and skip a decision model.
- A faster Jev that fails `P-G1` is a FAIL. Speed never offsets wrong merges.

## What to do if the experiment fails

1. Keep the current production behaviour and the call caps from TDR-043.
2. Report failed pairs and separate model errors from candidate-generation limits.
3. Propose a new protocol for any changed question or band. Do not tune on test errors and reuse the same test set as fresh evidence.

## Implementation notes

- Reuse the runner, manifest and checkpoint code from experiments 01 and 02 after their setup tasks exist. Do not duplicate it.
- Call the production prompts through a copy of their text pinned in the manifest. Do not import the production manager into the runner.
- Treat source text as data. It cannot change instructions, output paths or approvals.
- Keep logs to identifiers, timings, sizes and error codes.
- Production fixes, the cache-key finding and Jev integration are separate changes.

## Cleanup

Keep redacted raw results, manifests, checkpoints and the report in ignored local paths. Keep protocols and analysis code under version control. Ask before deleting weights or indexes. Never delete live OMMS data.

## Artefacts expected

| File / directory                      | Description                               |        Required?         |
| ------------------------------------- | ----------------------------------------- | :----------------------: |
| `protocol.md`                         | This plan                                 |     Yes, created now     |
| `report.md`                           | Results, discussion and conclusion        |  Yes, after evaluation   |
| `run_eval.py`                         | Arms, checkpoint and resume               |   Yes, after approval    |
| `summarise_eval.py`                   | Metrics and gate verdicts                 |   Yes, after approval    |
| `corpus/`                             | Redacted pairs, ground truth and manifest |  Yes, local and ignored  |
| `output/eval_results.json`            | Raw decision records                      |  Yes, after evaluation   |
| `output/eval_results_checkpoint.json` | Resume state                              |  Yes, during evaluation  |
| `output/eval_results.summary.json`    | Aggregated metrics and gate verdicts      |  Yes, after evaluation   |
| `analysis.py`                         | Read-only Jupytext analysis of local JSON | Yes, after results exist |

## Approval needed

Done on 2026-10-10: the user approved this plan, and the OpenSpec change now covers it (design decision 9, tasks 7.1 to 7.7).

Still needed before inference:

1. Set and freeze the speed-up factor (proposed 5 times), the fallback limit (proposed 30%) and the pair counts (task 7.5).
2. Approve setup, installs, redaction, corpus preparation, hosted transfer, spending limit and the blind review before each step.
3. Complete setup tasks 1.1 to 1.5, which this experiment reuses.

## References

- [OpenSpec proposal](../../openspec/changes/evaluate-memory-decision-models/proposal.md)
- [Experiment index](../EXP_README.md)
- [Label experiment](../01-label-decisions-2026-10-07/protocol.md)
- [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)
- [TypeSafe confidence](https://docs.typesafe.ai/confidence)
- [TypeSafe models](https://docs.typesafe.ai/models)
- [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy)
