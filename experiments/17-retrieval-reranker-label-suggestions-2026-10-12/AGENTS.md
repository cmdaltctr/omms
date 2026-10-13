# Experiment 17: reranker label suggestions for the review queue

- **Status**: PASS (2026-10-12), weak margin. Route B 46 of 67 first suggestions right; matched cosine 44 (sign test p = 0.85). Exploratory: agreement right 31 of 33; mixed three suggestions 60 of 67.
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: Does Qwen3-Reranker-0.6B put the right label first more often than cosine similarity, when suggesting a label for a reviewer to confirm?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- One runner, `run_eval.py`, with phases `run` and `verify`. `analysis.py` after results. Tests are outside the limit.
- Download the GGUF with `llama download -hf` into the shared Hugging Face cache; verify size and SHA-256.
- Own one llama.cpp server on `127.0.0.1:3008`; refuse an occupied port; stop only the owned child.
- Load Experiments 12 and 16 read-only, pinned. Never write outside this folder's `output/`.
- `--phase verify` recomputes from saved scores, without a server and without writes.
