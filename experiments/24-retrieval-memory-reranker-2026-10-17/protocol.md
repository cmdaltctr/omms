# Experiment 24: reranker for memory retrieval

- **ID**: `24-retrieval-memory-reranker-2026-10-17`
- **Category**: retrieval
- **Size**: Standard
- **Status**: PLANNED
- **Operator**: Dr Muhammad Aizat Bin Md Hawari, with Agent
- **Related**: Experiment 02 (larger retrieval plan, never run), Experiment 17 (same reranker, label suggestions), `src/services/turso/vector-search.ts`

## 1. Question

Does a reranker over the top 50 memories find more relevant memories in the final 10 than the current scorer?

If it does, we propose a reranker stage for memory retrieval on all hosts. If it does not, we test keyword search (BM25) next.

## 2. Hypothesis

- **H1 (primary)**: the reranker arm raises mean recall@10 by at least 0.05 over the current scorer. A two-sided sign test over prompts gives p < 0.05.
- **H0 (null)**: the gain is below 0.05, or p ≥ 0.05, or the reranker is worse.
- **Decision rule**: if H1 holds and both guardrails pass, write an OpenSpec proposal for a reranker stage. It must include a human-labelled confirmation run, because this key is AI-made. Otherwise keep the current scorer and plan a BM25 experiment.

## 3. What changes, what is measured, what stays fixed

| Changes (one thing) | Primary metric | Guardrail metrics | Fixed |
| --- | --- | --- | --- |
| Arm A (current scorer, top 10 above 0.6) vs Arm B (current scorer top 50, no cut-off, reranked, top 10) | recall@10: share of a prompt's relevant memories that the arm returns | precision: share of returned memories that are relevant. Reranker delay per prompt | Memory snapshot, prompts, `qwen3-embedding:0.6b` query vectors, scoring weights 0.6 and 0.4, Qwen3-Reranker-0.6B Q8_0 with Experiment 17 server settings |

Arm A copies `searchInShard` and `searchAcrossShards`. The score is 0.6 × content similarity plus 0.4 × the larger of tag similarity and the word-match boost. Arm A keeps memories with a score of 0.6 or more, then the top 10.

Arm A uses an exact scan over every eligible memory. Production uses an approximate index (ANN) with 128 candidates per index, so it can miss a few. The exact scan is the best case for the current scorer.

Arm B sends the prompt and each of the 50 memory texts to the reranker. It keeps the 10 with the highest reranker score.

Arm A0 (exploratory) is the top 10 by score with no cut-off. It shows how much of any gain comes from removing the cut-off, not from the reranker.

## 4. Data

| Item | Value |
| --- | --- |
| Source | Read-only copy of `~/.omms/data/projects/project_769e931b738f5620_shard_0.db` (1,519 omms memories) and of the omms rows in `~/.omms/data/user-prompts.db` (1,002 prompts of 40 characters or more) |
| Unit | One real prompt |
| Size | 60 prompts, random sample with seed 24 |
| Prompt filter | omms project path, 40 characters or more, not a slash command, no `<private>` tag, no duplicate text |
| Eligible memories | Created before the prompt, and not from the prompt's own session. Production also hides the current session. |
| Groups | Prompts from one session share a topic. Sampling takes at most 2 prompts per session. |
| Labels | A blind AI judge marks each pooled prompt–memory pair as relevant or not. The operator checks 20 random pairs. |
| Already seen | None. No earlier experiment used these prompts. |

**Pool.** Each prompt's pool is the union of Arm A0 top 10 and Arm B top 10, so at most 20 pairs. Arm A is a subset of A0. The judge sees pairs in random order, with no arm or rank.

**Relevant** means: the memory would help an assistant answer or act on the prompt.

**recall@10** for a prompt is the relevant memories an arm returns, divided by the relevant memories in the pool. Prompts with no relevant memory in the pool have no recall. They are left out of H1 and counted in the report.

## 5. Steps

Run every command from the worktree root `omms-chore-exp-24-retrieval-reranker`.

1. Copy and sample: `uv run --project experiments python experiments/24-retrieval-memory-reranker-2026-10-17/run_eval.py --phase prepare`
2. Check gates G1 and G2: `... run_eval.py --phase check`
3. Start the reranker server on port 3008 with Experiment 17 settings.
4. Run the arms: `... run_eval.py --phase run --resume`
5. Write the judge file `output/judge_input.jsonl`: `... run_eval.py --phase pool`
6. Judge: a Claude subagent reads `judge_input.jsonl` and writes `output/judge_labels.jsonl`.
7. Operator spot check: 20 random pairs on a small review page; saved to `output/spot_check.json`.
8. Summarise: `uv run --project experiments python experiments/24-retrieval-memory-reranker-2026-10-17/summarise.py`

## 6. Analysis

- **Stats level**: medium
- **Test for H1**: two-sided sign test on prompts where the two arms' recall@10 differ. Uses `sign_test` from the Experiment 18 runner, pinned by SHA-256.
- **Interval**: mean difference with win, loss and tie counts. No shared bootstrap helper exists.
- **Gates**:

| Gate | Pass when | Why it matters |
| --- | --- | --- |
| G1 integrity | Snapshot files and the reranker GGUF match their SHA-256 before and after the run | Results tie to fixed inputs |
| G2 embedding match | 5 random stored memories re-embedded through port 9931 have cosine ≥ 0.999 with their stored vectors | Query vectors match the stored ones |
| G3 coverage | At least 40 of 60 prompts have one or more relevant memories in the pool | Enough prompts for H1 |
| G4 completeness | Every prompt has all three arm lists. Every pool pair has a judgement. Errors count as misses. | Errors never count as hits |
| G5 key check | Operator agrees with the AI judge on at least 16 of 20 spot-check pairs | Some trust in the AI key |
| Guardrail P | Arm B precision ≥ Arm A precision − 0.10 | The reranker must not fill context with noise |
| Guardrail L | Reranker delay p95 ≤ 500 ms per prompt | Retrieval runs on every prompt |

- **Stop rule**: stop after `--phase check` if G1 or G2 fails. Record an amendment and ask the operator.
- **What each outcome means**:
  - Pass (H1, P and L hold): propose a reranker stage. Validity stays INCONCLUSIVE until a human-labelled run confirms it.
  - Fail: keep the current scorer. Plan Experiment 25 for BM25.
  - Unclear (gain ≥ 0.05 but p ≥ 0.05, or G3 or G5 fails): report INCONCLUSIVE. The operator decides on a larger run.

## Extra detail

### Environment

- Embedding: `qwen3-embedding:0.6b` on the operator's llama server at `127.0.0.1:9931`, as set in `~/.config/omms/omms.jsonc`. Task prefixes off, as in production.
- Reranker: Qwen3-Reranker-0.6B Q8_0 from Experiment 17, SHA-256 `22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48`, already in the Hugging Face cache. No download.
- Memory text sent to the reranker is cut at 4,000 characters. The run records how many were cut.

### Privacy and cloud

- The snapshot, prompts and results stay in `output/`, which git ignores.
- Embedding and reranking run on this machine.
- The AI judge is a Claude subagent. Prompt and memory text go to Anthropic, the same provider this session uses. API-key-like strings are redacted first.

### Cleanup

- Stop the reranker server after the run.
- Keep `output/` until the report is final.
