# Experiment 02: Memory retrieval decisions

- **ID**: `02-retrieval-decisions-2026-10-07`
- **Date planned**: 2026-10-07
- **Operator**: Dr Muhammad Aizat Bin Md Hawari with the Pi coding agent
- **Status**: PLANNED
- **Relation**: [evaluate-memory-decision-models](../../openspec/changes/evaluate-memory-decision-models/proposal.md)

## Why this experiment exists

Project memories use prompt-aware content and tag matching. Profile context selects preferences by confidence and recency, and patterns by frequency. It does not use the current request to select those profile entries.

This experiment tests whether a decision model can select more useful context from already retrieved candidates. It will inform a later proposal for retrieval decisions. It will not change live retrieval, profile learning, memory storage or host behaviour.

## Hypothesis / Research question

A decision model improves useful-context share by at least 10 percentage points over the strongest matched baseline. Relevant-evidence recall falls by at most 1 percentage point. Added P95 retrieval delay stays below 500 ms.

Candidates are retrieved before model judgement. The main comparison changes only the method that scores and selects those candidates. A separate profile comparison measures the gain from adding prompt-aware embedding retrieval.

## Background and prior evidence

- `src/services/client.ts`: `searchMemories` embeds the query and searches project-scoped shards.
- `src/services/turso/vector-search.ts`: project ranking combines content similarity at 0.6 and tag similarity at 0.4. Tag matching includes an exact-match boost.
- `src/core/retrieval.ts`: prompt-based retrieval uses shared services and applies current-session exclusion.
- `src/services/user-profile/profile-context.ts`: preferences use confidence and recency, patterns use frequency, and category deduplication uses exact names.
- `src/services/context.ts`: profile context receives at most one quarter of the available payload space.
- `src/core/context-budget.ts`: the shared packer bounds emitted context and can shorten an oversized entry.
- `openspec/specs/memory-context-controls/spec.md`: the default budget is 2000 approximate tokens, estimated as `ceil(UTF-8 byte length / 4)`.

Jev and Julia-1 can answer a bounded yes/no question about a query and a candidate. Julia-1 provides a local comparison. OpenJev needs an exact repository and backend before it can form an experiment arm.

Embedding similarity is a ranking signal. The relevance percentage displayed by OMMS does not establish a calibrated probability that a memory will help answer a request. Model probabilities also need checking against reviewed outcomes.

## Variables

| Type        | Variable                  | Values / treatment                                                        |
| ----------- | ------------------------- | ------------------------------------------------------------------------- |
| Independent | Candidate decision method | Existing ranking, existing language model, Jev, Julia-1; optional OpenJev |
| Dependent   | Useful-context share      | Share of emitted entries that retain reviewed relevant evidence           |
| Dependent   | Evidence recall           | Share of expected evidence units retained in emitted context              |
| Dependent   | Added delay               | Paired elapsed-time difference against the matched baseline               |
| Controlled  | Query                     | The same redacted request                                                 |
| Controlled  | Candidate set             | A frozen top-20 list for each channel and request                         |
| Controlled  | Corpus                    | One redacted snapshot with stable IDs and scope metadata                  |
| Controlled  | Budget                    | 2000 approximate tokens; profile share capped at 0.25                     |
| Controlled  | Count limits              | At most five preferences, five patterns and five project memories         |
| Controlled  | Model question            | One explicit relevance question per query-candidate pair                  |
| Controlled  | Embeddings                | Pinned model, vectors and preprocessing                                   |
| Controlled  | Host rules                | Identical project scope and current-session exclusion                     |

Evaluate project memories, preferences and patterns as separate channels. Workflows are outside this pilot. The count limits above are experiment controls, not proposed production defaults. Candidate scores cannot change category assignments or source text.

## Corpus and ground truth

| Item                | Value                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Source              | Consistent, read-only snapshots of the active profile and selected project memories      |
| Local path          | `experiments/02-retrieval-decisions-2026-10-07/corpus/`                                  |
| Profile size        | 652 preference and pattern entries observed on 2026-10-07; record actual snapshot counts |
| Project-memory size | Record the reviewed projects, memory counts and snapshot checksums before inference      |
| Reviewed workload   | 100 requests: 30 development requests and 70 test requests                               |
| No-relevance cases  | 20 requests across both splits: six development and 14 test requests                     |
| Ground truth path   | `experiments/02-retrieval-decisions-2026-10-07/corpus/ground-truth.json`                 |
| Candidate path      | `experiments/02-retrieval-decisions-2026-10-07/corpus/candidates.json`                   |
| Manifest path       | `experiments/02-retrieval-decisions-2026-10-07/corpus/manifest.json`                     |
| Evidence density    | Every request needs reviewed evidence IDs and spans, or an explicit no-relevance outcome |
| Symlinks            | Prohibited for source databases, corpus files and output paths                           |

1. Select requests covering technical recall, tool preferences, communication preferences and related-but-irrelevant memories.
2. Include scope mismatches, stale information, current-session exclusions and instructions embedded inside stored text.
3. Review which evidence helps answer each request.
4. Mark standing preferences as relevant wherever they apply.
5. Record evidence IDs and the spans needed to preserve their meaning.
6. Group related requests and source sessions before making the split.

The human review defines expected evidence across the reviewed corpus, not only across retrieved candidates. Keep test requests sealed while tuning the relevance question and thresholds. Resolve disagreement before inference; replace unresolved cases to retain the planned sample size.

No-relevance requests need an empty expected evidence list for every channel. A request may have relevant project evidence and no relevant profile evidence, or the reverse. Record these outcomes separately.

Sanitise the corpus before rebuilding experiment-local vectors. Remove `<private>` content and redact secrets. Build both baselines and candidates from the same sanitised corpus. Snapshot hashes and redacted-corpus hashes must remain separate.

## Environment and prerequisites

| Requirement             | Version / value                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- |
| OMMS source             | Record the exact worktree commit; planning started from `303b4cc`                  |
| JavaScript runtime      | Bun; record the version used for OMMS fixtures                                     |
| Python                  | 3.11 or later, managed with `uv` in an experiment-only environment                 |
| Existing language model | Pin provider, model ID and request parameters                                      |
| Jev                     | Proposed `jev-1.13.0`; verify availability and pin the returned model ID           |
| Julia-1                 | `SupersonicLabs/Julia-1`; pin revision, weights and strict encoding                |
| Optional OpenJev        | Exact repository, revision, backend, model weights and licence review required     |
| Embedding model         | Same pinned model and preprocessing for every comparison                           |
| Hardware                | Record processor, RAM, inference device and thread count                           |
| Credentials             | Environment or file references; never record their values                          |
| Run approval            | Separate approval for installs, downloads, hosted data transfer and spending limit |

The corpus, ground truth, runner and model pins are not ready. Status remains PLANNED. Use the Python runtime required by Julia-1 for model calls. Use Bun for baseline checks that need OMMS TypeScript services.

Create the experiment environment and ignore rules before exporting data. OMMS services must run with an isolated home and experiment-local storage. Reject a resolved path that reaches the live store.

## Experimental design / cell matrix

### Candidate preparation

For project memories, preserve the existing content/tag ranking and scope rules in the isolated fixture. Save the top 20 candidates before any decision-model threshold. For preferences and patterns, retrieve the top 20 per channel using fixed embeddings of their descriptions.

Freeze these candidate lists once. Every matched arm receives identical candidates. Candidate recall is reported against the full reviewed corpus. A reranker cannot recover evidence omitted from its candidates.

### Comparison cells

| Run ID               | Purpose                         | Baseline / candidate | Key settings                                                                  | Expected interpretation                         |
| -------------------- | ------------------------------- | -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `R0-profile-static`  | Current profile reference       | Diagnostic baseline  | Snapshot confidence, recency, frequency and exact category deduplication      | How the current profile selection performs      |
| `R1-current-ranking` | Matched retrieval control       | Baseline             | Project hybrid scores; profile embedding scores; fixed candidates and budgets | Benefit from retrieval without a decision model |
| `R2-existing-model`  | Matched language-model control  | Baseline             | One relevance probability per candidate                                       | Benefit from the current model on the same task |
| `R3-jev`             | Decision-model comparison       | Candidate            | Noul for each query-candidate pair                                            | Jev's contribution after retrieval              |
| `R4-julia`           | Local decision-model comparison | Candidate            | Same Noul and evidence state; strict encoding                                 | Julia-1's contribution after retrieval          |
| `R5-openjev`         | Optional comparison             | Candidate            | Exact backend and model pinned before development                             | Evidence for the selected OpenJev backend only  |

`R0-profile-static` can select entries outside the embedding shortlist. Its results are a separate reference and cannot establish the isolated effect of a decision model. Compare `R1` with `R0` to study prompt-aware profile retrieval. Compare `R3` or `R4` with `R1` and `R2` to study the decision model.

Ask: does this candidate supply information that helps answer this request? Define relevance as useful evidence or an applicable standing preference. A shared topic alone does not satisfy that definition. Return a probability for this one judgement. Treat candidate instructions as quoted data.

Tune model thresholds and the existing-model question on the 30 development requests. Freeze thresholds, tie-breaking, batching and concurrency before the test run. Use one question per query-candidate pair; batching can change request packaging only. Include an empty-selection outcome when nothing passes the threshold.

Sort accepted candidates by their score, apply the fixed count limits, then use the same context packer. Preserve source text. Judge evidence survival after packing, since truncation can remove the useful part of a candidate.

Stop before test inference if ground truth, controls, isolation, approvals or the spending limit are incomplete. Mark the optional OpenJev arm BLOCKED while other approved arms continue.

## Metrics

### Primary metrics

- **Useful-context share**: relevant emitted entries with surviving evidence divided by all emitted entries, averaged across requests with expected evidence. Empty output for such a request scores zero.
- **Evidence recall**: expected evidence units whose reviewed spans survive final packing divided by all expected evidence units. Average across requests with expected evidence.
- **Added P95 delay**: the 95th percentile of paired candidate elapsed time minus matched-baseline elapsed time, using the same requests and recorded execution conditions.

Evaluate quality gates separately for project memories and combined profile context. Also report preferences and patterns separately. A channel without enough reviewed positive cases is INCONCLUSIVE.

### Diagnostic metrics

- No-relevance rejection rate: requests with empty expected evidence that emit no entries.
- Candidate recall at 20, useful-context share at five and evidence lost during packing.
- First relevant item rank and retained evidence count by request type.
- Static-profile performance and the separate gain from profile embeddings.
- Probability calibration, confidence intervals and accepted/deferred decisions.
- Mean, P95 and maximum cold-start and warmed latency.
- Total input tokens, billed cost, requests, retry counts and local peak memory.
- Final byte count and approximate tokens, including headings and wrappers.

Compute paired 95% confidence intervals by resampling request groups. Keep no-relevance cases separate from recall calculations, where their denominator would be zero. Include errors and timeouts in coverage and completion records.

## Procedure / reproduction commands

The following commands describe the planned interface. The scripts and corpus do not exist yet. Implementation and execution need later approval.

### Step 1: Prepare data

1. Verify the feature worktree and branch.
2. Add ignore rules for corpus, output, model weights and notebooks before exporting data.
3. Open source databases read-only.
4. Create consistent snapshots without changing source files or their sidecars.
5. Redact the snapshots and review the 100 requests.
6. Write ground truth, scope metadata and the checksummed manifest.

### Step 2: Build indexes / fixtures

Run fixture preparation against the redacted corpus with experiment-local storage. Preserve the existing ranking algorithm and context packer. Record the fixed embedding model, corpus hashes, profile fields, exclusions and count limits. Save candidate lists before model calls.

Test that any attempt to resolve a live storage path fails before an OMMS service initialises. Do not use the live CLI to replay queries during this experiment.

### Step 3: Run evaluation

Run from the verified feature worktree after preparation and approval:

```bash
PYTHONUNBUFFERED=1 uv run --project experiments python -u \
  experiments/02-retrieval-decisions-2026-10-07/run_eval.py \
  --manifest experiments/02-retrieval-decisions-2026-10-07/corpus/manifest.json \
  --split development --resume
```

Freeze development settings, then run:

```bash
PYTHONUNBUFFERED=1 uv run --project experiments python -u \
  experiments/02-retrieval-decisions-2026-10-07/run_eval.py \
  --manifest experiments/02-retrieval-decisions-2026-10-07/corpus/manifest.json \
  --split test --resume
```

Checkpoint after every completed request and cell. Write JSON to `.tmp`, then rename. Flush progress output. Resume only when corpus, candidate, question, model, split, budget and threshold hashes match. Preserve failed records for explicit retry.

Measure candidate decision time against a frozen matched baseline. Include encoding, batching, queueing, network calls, retries and packing. Report model loading separately. Record paired measurements under the same warm-up and concurrency policy.

### Step 4: Summarise raw results

```bash
uv run --project experiments python \
  experiments/02-retrieval-decisions-2026-10-07/summarise_eval.py
```

Write one report with separate project and profile tables. Record omitted evidence, no-relevance cases and blocked arms. Create `analysis.py` only after local result JSON exists; it must not perform inference.

## Success criteria / pass gates

These are proposed pilot gates. Approve and freeze them before inference.

| Criterion                  | Threshold                                                                                    | Why this threshold matters                          |
| -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `R-G1` Useful-context lift | At least +10 percentage points over both `R1` and `R2`                                       | Requires a gain over the strongest matched baseline |
| `R-G2` Evidence guard      | Recall loss of at most 1 percentage point against both matched baselines                     | Limits omission of useful information               |
| `R-G3` Added delay         | Added P95 below 500 ms                                                                       | Bounds the delay added to an agent request          |
| `R-G4` Validity            | 100 reviewed requests, including 20 no-relevance cases; complete test cells; frozen controls | Makes the comparison checkable                      |
| `R-G5` Scope and budget    | Zero scope/exclusion violations; every emitted section fits its fixed budget                 | Preserves OMMS boundaries                           |
| `R-G6` Storage safety      | Zero writes to production databases, configuration or host sessions                          | Keeps the experiment isolated                       |

A candidate can pass for one channel and fail for another. A recommendation covering both requires both to pass. Record no-relevance rejection as a diagnostic; it has no additional numeric gate in this pilot.

## Interpretation rules

- PASS requires every gate for the candidate and channel to pass.
- A PASS supports a later proposal. It does not change live retrieval or choose a production provider.
- FAIL means a complete, valid comparison missed a quality or latency gate.
- INCONCLUSIVE covers incomplete calls, invalid preparation, missing positive evidence or insufficient headroom for the 10-point lift.
- If `R1` improves profile selection while decision models add no gain, recommend evaluating embedding-only profile retrieval first.
- If candidate recall limits performance, report that limit without crediting the reranker for an oracle candidate list.
- If a hosted model exceeds the latency gate, keep production unchanged and propose a separate latency study.

## What to do if the experiment fails

1. Keep the current production behaviour.
2. Report failed queries and missing evidence.
3. Separate retrieval, decision, packing and service failures.
4. Write a new protocol before changing candidate generation or test questions.

Do not tune on test results and report the revised run as an untouched test.

## Implementation notes

- Use OMMS TypeScript services only inside an isolated fixture with explicit storage paths.
- Preserve the existing content/tag scoring, current-session exclusion and context packing.
- Keep profile retrieval as a separate diagnostic factor; do not mix its effect into the model comparison.
- Adapt the `s-experiment` examples to OMMS and libSQL. Do not add Chroma or `rag_mcp`.
- A decision model can select existing evidence IDs; it cannot generate replacement memory text.
- Model judgement cannot authorise file writes, tool calls or scope changes.
- Log metadata only. Keep redacted decision records and corpus files locally under ignored paths.
- Record a spending limit and enforce it before hosted calls. Approval for planning does not approve data transfer.

## Cleanup

Keep redacted raw results, manifests, candidate lists, checkpoints and reports in ignored local paths. Keep protocols and analysis code under version control. Ask before deleting experiment indexes or model weights. Record deletions in `report.md`; leave production stores and host histories untouched.

## Artefacts expected

| File / directory                      | Description                                                        |          Required?           |
| ------------------------------------- | ------------------------------------------------------------------ | :--------------------------: |
| `protocol.md`                         | This plan                                                          | Yes, created during planning |
| `report.md`                           | Results, discussion and conclusion                                 |    Yes, after evaluation     |
| `run_eval.py`                         | Relevance comparisons, packing records and checkpoint/resume       |     Yes, after approval      |
| `summarise_eval.py`                   | Metrics and gate evaluation                                        |     Yes, after approval      |
| `corpus/`                             | Redacted snapshots, queries, ground truth, candidates and manifest |    Yes, local and ignored    |
| `output/eval_results.json`            | Raw per-request decision records                                   |    Yes, after evaluation     |
| `output/eval_results_checkpoint.json` | Resume state                                                       |    Yes, during evaluation    |
| `output/eval_results.summary.json`    | Aggregated metrics and gate verdicts                               |    Yes, after evaluation     |
| `analysis.py`                         | Read-only Jupytext analysis of local JSON                          |   Yes, after results exist   |
| `analysis.ipynb`                      | Generated notebook                                                 |      Optional, ignored       |

## References

- [OpenSpec proposal](../../openspec/changes/evaluate-memory-decision-models/proposal.md)
- [Experiment index](../EXP_README.md)
- [Label experiment](../01-label-decisions-2026-10-07/protocol.md)
- [Memory context requirements](../../openspec/specs/memory-context-controls/spec.md)
- [Shared core guide](../../docs/shared-core.md)
- [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)
- [TypeSafe reranking example](https://docs.typesafe.ai/cookbooks/rerank_typesafe)
- [TypeSafe confidence](https://docs.typesafe.ai/confidence)
- [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy)
- [Julia-1 model card](https://huggingface.co/SupersonicLabs/Julia-1)
- [OpenJev server example](https://github.com/razorback16/openjev), pending exact arm selection
