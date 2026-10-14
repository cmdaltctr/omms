# Experiment 16: neighbour gate with the larger Qwen3 4B embedder

- **ID**: `16-retrieval-neighbour-gate-qwen3-4b-2026-10-11`
- **Category**: retrieval
- **Size**: Quick
- **Status**: FAIL — post-hoc exploratory (2026-10-11)
- **Operator**: Dr Muhammad Aizat Md Hawari, with an agent session
- **Related**: [Experiment 12 report](../12-retrieval-neighbour-reuse-gate-2026-10-11/report.md); [Experiment 14 report](../14-retrieval-neighbour-gate-fewer-neighbours-2026-10-11/report.md)

## Answer

- **Question**: Does Experiment 12's neighbour gate pass Tier 1 with the larger Qwen3-Embedding-4B, plain or with an intent instruction?
- **Answer**: No. Plain accepted nothing. With the intent instruction, the gate accepted 1 case, and that pick was wrong: a label on a case where no label fits. Source: `output/summary.json`.
- **Decision**: A bigger embedder does not rescue the neighbour gate. Review-first assignment stays (ADR-027).
- **How sure**: High for this data. The diagnostic lands at "both matter": the intent instruction helps, but about 3 examples per label is still too few.
- **Next step**: Automatic first assignment waits for more reviewed examples per label. The intent instruction is the one setting worth keeping for that rerun.

## Plan (written before the run)

Experiment 12 failed for two possible reasons: the 0.6B embedder groups observations by topic rather than intent, and each label has only about 3 examples. This run changes only the embedder, to tell those two reasons apart.

- **Change**: the embedder, from `qwen3-embedding:0.6b` (Q8_0, 1,024 dimensions, Experiment 01 cache) to `Qwen3-Embedding-4B-Q8_0.gguf` (Hugging Face `Qwen/Qwen3-Embedding-4B-GGUF`, revision `f4602530db1d980e16da9d7d3a70294cf5c190be`, 4,279,660,224 bytes, SHA-256 `b60ae5ce2dd6a0b77f82cadf21def1f310a3e10cde380ad0081b07a9d416949d`). Same Q8_0 precision as the 0.6B model, so only model size changes. Everything else is Experiment 12's frozen gate: 3 agreeing neighbours, threshold grid, 5 group folds, inner leave-one-group-out selection, acceptable-label sets and the Experiment 11 ruler.
- **Cells**:
  - `plain`: each text embedded as Experiment 01 did: punctuation replaced by spaces, whitespace collapsed.
  - `instruct`: the same text after the Qwen3 instruction format, on every text: `Instruct: Identify the user's underlying preference or working pattern that this observation expresses, ignoring the specific tool or topic\nQuery:` followed by the text.
- **Baseline**: Experiment 12 with the 0.6B embedder: 1 correct, 0 wrong.
- **H1**: `plain` or `instruct` passes Tier 1: W = 0 and C ≥ 29 over the 140 pooled held-out decisions.
- **H0**: neither passes.
- **Prediction, stated before the run**: both fail. Experiment 15's much larger Clef model kept at most 9 correct even with a cut-off tuned on the answers.
- **Diagnostic, preregistered**: how often the nearest outer-gallery neighbour carries an acceptable label, out of 67 labelled test cases. Experiment 12 gave 32.
  - 50 or more: the embedder was the main gap. A larger embedder or more data could make the gate work.
  - 40 or fewer: the data, about 3 examples per label, is the main gap.
  - In between: both matter.
- **Status rule**: post-hoc exploratory. The test cases were inspected in Experiments 12 to 15. Results cannot approve a production change.
- **Method**: `run_eval.py` downloads the pinned GGUF into the ignored `output/.models/` and checks its SHA-256. It runs the pinned llama.cpp b11510 server (from the Experiment 03 manifest) as its own child on `127.0.0.1:3007`, with `--embedding --pooling last` and an 8,192 batch, matching how OMMS serves the 0.6B model. It embeds the 200 cases through `/v1/embeddings`, saves the vectors under `output/` and pins them by SHA-256. The Llama app and `models.user.ini` are not touched. It loads Experiment 12's runner read-only (SHA-256 `10a458e9020e07b9b7fca10a41ebb348b8f5f21ce9586faa434291053d98444b`) and replaces its vector loader for each cell, because that runner takes no settings object.
- **Approval**: on 2026-10-11 the operator chose llama.cpp over Ollama, and approved the 4.28 GB Q8_0 download and the run.
- **Run**: `uv run --project experiments --no-sync python experiments/16-retrieval-neighbour-gate-qwen3-4b-2026-10-11/run_eval.py`
- **Verify**: the same command with `--verify`. It recomputes from the saved vectors, with no model calls and no writes.

## Results

| Embedder               | Accepted | Correct | Wrong | Nearest neighbour acceptable | Nearest has a label on a `none_fit` case | Best zero-wrong rule on test (exploratory) |
| ---------------------- | -------: | ------: | ----: | ---------------------------: | ---------------------------------------: | -----------------------------------------: |
| 0.6B, plain (Exp 12)   |        1 |       1 |     0 |                     32 of 67 |                                 46 of 73 |                                          2 |
| 4B, plain              |        0 |       0 |     0 |                     24 of 67 |                                 40 of 73 |                                          1 |
| 4B, intent instruction |        1 |       0 |     1 |                     41 of 67 |                                 44 of 73 |                                          0 |

Source: `output/summary.json`, keys `cells.plain` and `cells.instruct`. The Experiment 12 row comes from `../12-retrieval-neighbour-reuse-gate-2026-10-11/output/summary.json` and its `analysis.py`.

What the numbers mean:

- **Plain 4B is worse than plain 0.6B.** The nearest neighbour is right for 24 of 67 labelled cases, against 32. A bigger model alone sharpens topic matching, not intent matching.
- **The intent instruction helps.** It lifts the nearest-neighbour score to 41 of 67, the best of any embedding so far. Pointing the model at intent works.
- **It does not fix forced labels.** On 44 of 73 `none_fit` cases the nearest neighbour still carries a label. The one accepted pick was exactly that error: the gate parked 27 of Experiment 06's 28 forced labels and accepted the 28th.
- **Preregistered diagnostic**: 41 sits in the "both matter" band (41 to 49). The embedder was part of the gap; the thin labels are the rest.

Gates: the GGUF matched its pinned size and SHA-256; the pinned llama.cpp b11510 server verified; all 200 cases embedded at 2,560 dimensions in both cells; `--verify` reproduced the summary from saved vectors. The owned server on port 3007 stopped after the run. Learning curves stay flat (mean correct below 1 at every gallery size).

## Limits

1. Post-hoc exploratory: the test cases were inspected in Experiments 12 to 15.
2. One instruction wording, written before the run. Another wording could score differently.
3. The runner replaces Experiment 12's vector loader per cell, because that runner takes no settings object; the tests check the loader is restored.
4. The 4.28 GB GGUF sits in this experiment's ignored `output/.models/`, not in the shared Hugging Face cache.
