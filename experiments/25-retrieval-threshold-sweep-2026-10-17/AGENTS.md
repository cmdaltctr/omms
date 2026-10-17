# Experiment 25: similarity threshold sweep

- **Status**: PASS, post-hoc (2026-10-17). See `report.md`.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Which `similarityThreshold` gives the best balance of recall and noise for the current scorer with `qwen3-embedding:0.6b`?
- **Files**: `report.md` holds the plan and the report; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script: `sweep.py`. Tests are outside the limit.
- Read Experiment 24 `output/` only. Never write there. Reuse its scoring functions by import; do not copy them.
- Use the operator's embedding server on port 9931 for the 60 query embeddings only. No reranker, judge, paid or web calls.
- Stop if gate G1 fails; record the difference in `report.md` and ask.
