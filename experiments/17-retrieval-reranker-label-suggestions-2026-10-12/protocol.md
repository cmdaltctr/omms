# Experiment 17: reranker label suggestions for the review queue

- **ID**: `17-retrieval-reranker-label-suggestions-2026-10-12`
- **Category**: retrieval
- **Size**: Standard
- **Status**: PASS on the frozen rule, weak margin (2026-10-12); see [report](report.md)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [ADR-024](../../docs/adr/024-review-first-label-assignment.md); Experiments 12, 15 and 16

## 1. Question

Does Qwen3-Reranker-0.6B put the right label first more often than cosine similarity, when suggesting a label for a reviewer to confirm?

The decision: which method fills the suggested label in the review queue (`review-first-assignment`), where a person confirms every first label.

## 2. Hypothesis

- **H1 (primary)**: the better of the two reranker routes gets at least 46 of the 67 labelled test cases right with its first suggestion.
- **H0**: both routes get 45 or fewer right.
- **Decision rule**:
  - H1 holds: the reranker becomes the recommended suggestion engine for a later production proposal.
  - H1 fails but a route beats the cosine baseline on the same shortlist: report a modest gain; the operator decides whether the extra model is worth it.
  - Otherwise: keep cosine suggestions.

Why 46: the best cosine method so far gets 41 of 67 (Experiment 16, 4B embedder with an intent instruction). Clef choosing among all labels gets 49 (Experiment 15) at about 3 seconds per item. 46 is a clear gain over cosine and close to Clef.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing)                  | Primary metric                                     | Guardrail metric                | Fixed                                                                                    |
| ------------------------------------ | -------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| Cosine ordering vs reranker ordering | top-1 suggestion correct, out of 67 labelled cases | seconds per item; top-3 correct | Experiment 12 folds and galleries, Experiment 16 instruct vectors, acceptable-label sets |

Two reranker routes, both on the same 140 cases:

- **Route A, by past examples**: rerank the 10 nearest outer-gallery observations, by Experiment 16 instruct-vector cosine. The suggestion is the label of the first reranked observation that carries an existing label.
- **Route B, by label definitions**: rerank every same-section label definition. The suggestion is the top label.

The cosine baseline uses Route A's shortlist in cosine order, with the same suggestion rule. So Route A and the baseline differ only in ordering.

## 4. Data

| Item         | Value                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Source       | Experiment 01 corpus; Experiment 10 reference; Experiment 11 acceptable sets; Experiment 16 instruct vectors |
| Unit         | one observation case                                                                                         |
| Size         | 140 test cases: 67 with a label (scored for H1), 73 `none_fit` (reported)                                    |
| Groups       | Experiment 12's 5 group folds; shortlists come only from each case's outer gallery                           |
| Labels       | Test: Experiment 10 reference, operator-arbitrated. Gallery development labels: AI-authored                  |
| Already seen | Experiments 05 to 16 used these cases. No reranker setting is tuned on them                                  |

## 5. Steps

Run every command from the repository root. The operator approved the plan, the 639 MB download and the run on 2026-10-12.

1. Download: `llama download -hf ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF:Q8_0` into the shared Hugging Face cache.
2. Focused tests: `uv run --project experiments --no-sync python -m pytest experiments/17-retrieval-reranker-label-suggestions-2026-10-12/test_run_eval.py`
3. Run: `uv run --project experiments --no-sync python -u experiments/17-retrieval-reranker-label-suggestions-2026-10-12/run_eval.py --phase run --resume`
4. Verify without a server: `uv run --project experiments --no-sync python experiments/17-retrieval-reranker-label-suggestions-2026-10-12/run_eval.py --phase verify`

## 6. Analysis

- **Stats level**: basic counts and rates. Paired counts against the cosine baseline: cases only the reranker gets right, and cases only cosine gets right.
- **Test for H1**: count rule, 46 of 67. No significance test.
- **Gates**:

| Gate            | Pass when                                                                                     | Why it matters                       |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| G1 integrity    | GGUF size and SHA-256, server binary and every input pin verify before and after              | results tie to frozen inputs         |
| G2 completeness | every case has a valid reranker result in both routes; errors are reported and count as wrong | errors never count as right          |
| G3 fold hygiene | shortlists come only from the case's outer gallery; a test injects a leak and sees a refusal  | the reranker must not see the answer |

- **Stop rule**: stop when both routes are scored for all 140 cases. Stop on a G1 or G3 failure.

## Extra detail

### Reranker request, frozen

- Endpoint `/v1/rerank` on an owned llama.cpp b11510 server (Experiment 03 manifest binary) on `127.0.0.1:3008`, started with `--reranking --ctx-size 8192 --batch-size 8192 --ubatch-size 8192 --parallel 1 --gpu-layers all --offline`.
- Query: the observation description. Documents: past observation descriptions (Route A) or label definitions (Route B).
- The model's built-in instruction is used unchanged. It may be a fixed web-search instruction. The runner records the server's reranking template, and the report states what it was.
- Scores: the returned `relevance_score`, higher first. Ties break by document order.

### Secondary measures, reported

- Top-3 correct: the right label among the first 3 distinct existing labels.
- Route A on `none_fit` cases: how often the first reranked observation is itself `none_fit`.
- Seconds per item for each route.
- Shortlist coverage: labelled cases whose right label appears anywhere in Route A's 10 observations. This caps Route A.

### Exploratory, labelled as such

- Safety ceiling: rank all 140 Route B suggestions by top score. Report the most correct picks possible with zero wrong, where a suggestion on a `none_fit` case is wrong. Tier 1 needs 29. This uses the test answers, so it is a ceiling, not a result.
- Intent-framed query: the same routes with the query prefixed by `Find the one that expresses the same user preference or working pattern as this observation: `.

### Input pins

| Input                                                                                                              | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `../12-retrieval-neighbour-reuse-gate-2026-10-11/run_eval.py`                                                      | `10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b` |
| `../16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/output/vectors-instruct.json`                                  | `133623b9b2c3ee8db067b4dfac488cfa362cc17795edada55c5c647b7b588a97` |
| `../03-pair-decisions-2026-10-10/corpus/clef-test-manifest.json` (server binary pin)                               | `24918e90eea694464e58d6552d1cc4582dfd27f7b37ff664131f500e7fe53db6` |
| `qwen3-reranker-0.6b-q8_0.gguf` (ggml-org, revision `a02f48bb4f057028298c21fa033da2b30d7742d5`, 639,153,184 bytes) | `22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48` |

Experiment 12's runner checks its own pins: corpus, reference and acceptable sets.

### Validity

- No official Qwen GGUF of this reranker exists. The file comes from `ggml-org`, the llama.cpp maintainers.
- Development labels are AI-authored. The test reference is operator-arbitrated.
- This measures suggestion quality only. It cannot approve automatic labelling.

### Privacy and cloud

No hosted calls. Loopback only. The runner refuses text containing `<private>` and logs counts, identifiers and hashes only.

### Scripts

`run_eval.py` with phases `run` and `verify`. `analysis.py` after results. Tests are outside the three-script limit.

### Amendments

None at planning. Planned at commit `fb699eb7c85ee30a12218e5b375f54ba78c5592c`.
