# Experiment 17: reranker label suggestions for the review queue

- **ID**: `17-retrieval-reranker-label-suggestions-2026-10-12`
- **Category**: retrieval
- **Size**: Standard
- **Status**: PASS on the frozen rule, with a weak margin (2026-10-12)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [protocol](protocol.md); [ADR-024](../../docs/adr/024-review-first-label-assignment.md); Experiments 12, 15 and 16

## Answer

- **Question**: Does Qwen3-Reranker-0.6B put the right label first more often than cosine similarity, when suggesting a label for a reviewer to confirm?
- **Answer**: Barely. Reranking the label definitions (Route B) got 46 of 67 first suggestions right, which meets the frozen target of 46. But cosine on the same shortlist, with the same rule, got 44. The 2-case gap is not a real difference (sign test p = 0.85). Source: `output/summary.json`; `analysis.py`.
- **Decision**: The reranker alone does not clearly beat cosine. The useful finding is exploratory: the two methods make different mistakes. When they agree, they are right 31 of 33 times, and showing both methods' suggestions puts the right label on screen for 60 of 67 cases.
- **How sure**: Medium. One test set of 67 labelled cases; the combination result was found after looking.
- **Next step**: Confirm the "agree" signal and the mixed three-suggestion list on fresh labelled data before any production proposal.

## What ran

1. `llama download -hf ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF:Q8_0` put the 639 MB file in the shared Hugging Face cache. Size and SHA-256 matched the pin.
2. The pinned llama.cpp b11510 server ran as this experiment's own child on port 3008 with `--reranking`, then stopped.
3. 560 reranks: 140 cases, 2 routes, 2 query wordings. 0 errors.
4. `--phase verify` rebuilt every request, matched each saved request hash and reproduced the summary without a server.

Focused tests: 9 pass. 8 deliberate faults in throwaway copies each made at least one test fail. The server's settings did not mention a web-search instruction (`output/run-manifest.json`, key `template`).

## Results

### First suggestion right, out of 67 labelled cases

| Method                                         | First right | Right among 3 | Seconds per item |
| ---------------------------------------------- | ----------: | ------------: | ---------------: |
| Cosine, 10 nearest, first existing label       |          44 |            56 | (shortlist only) |
| Route A: reranker re-sorts those 10            |          41 |            56 |             0.24 |
| **Route B: reranker scores label definitions** |      **46** |            55 |             0.44 |
| Clef choosing among all labels (Exp 15)        |          49 |             – |             ~3.0 |

Source: `output/summary.json`, keys `cosine_baseline` and `routes`; Clef from Experiment 15.

- **H1 holds by the frozen rule**: 46 is at least 46.
- **The matched baseline was stronger than planned.** The plan quoted 41 for cosine. That number counted a `none_fit` neighbour as the suggestion. With the same "first existing label" rule that both routes use, cosine gets 44.
- **Route A made cosine worse**: 41 against 44. Re-sorting past observations by the reranker loses intent information the embedder had.
- **Shortlist coverage**: the right label appears among the 10 nearest observations for 63 of 67 cases.

### Route B against cosine, case by case (exploratory)

| Outcome            | Cases |
| ------------------ | ----: |
| Both right         |    32 |
| Only Route B right |    14 |
| Only cosine right  |    12 |

The two methods disagree on 34 cases and split them almost evenly. Sign test on those disagreements: p = 0.85, so no real winner. Source: `analysis.py`.

### The useful finding: they fail on different cases (exploratory)

- **When both suggest the same label**, it is right 31 of 33 times on labelled cases.
- **They also agree on 14 of 73 `none_fit` cases.** So agreement is a strong hint for a reviewer, not a safe automatic rule.
- **Three suggestions on screen**: Route B's top 2 plus cosine's best other label put the right label on screen for 60 of 67 cases. Either method alone shows it for 55 or 56.

Source: `analysis.py`, from `output/scores.json`.

### Other measures

- **Intent-worded query (exploratory)**: worse in both routes: A 40, B 44.
- **Safety ceiling (exploratory)**: ranking Route B by its top score, at most 13 correct before the first wrong pick. Tier 1 needs 29. Automatic labelling stays out of reach.

Source: `output/summary.json`, keys `exploratory` and `routes.*.safety_ceiling`.

## Limits

- 67 labelled cases. A 2-case gap cannot separate the methods.
- The agreement and mixed-list findings came after looking at results. They need fresh data.
- The cosine shortlist uses Experiment 16's 4B embedder with the intent instruction. Production OMMS uses a different embedder.
- Development labels in the galleries are AI-authored; the test reference is operator-arbitrated.
- The reranker GGUF comes from `ggml-org`, not from Qwen directly.

## What this means for the review queue

1. Cosine alone is nearly as good as the reranker for the first suggestion, and needs no extra model.
2. Showing three suggestions from both methods is the strongest option seen: the right label is on screen 9 times in 10.
3. "Both methods agree" can mark a suggestion as likely right, but never as automatic.
