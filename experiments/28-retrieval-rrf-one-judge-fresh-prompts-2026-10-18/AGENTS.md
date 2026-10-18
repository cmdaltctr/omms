# Experiment 28: RRF against the boost with one judge, on two prompt sets

- **Status**: PLANNED (2026-10-18). See `report.md`.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: When one judge labels every pair, does reciprocal rank fusion (RRF) find more relevant memories in the top 10 than the keyword boost, on the Experiment 24 prompts and on the Experiment 26 fresh prompts?
- **Files**: `report.md` holds the plan and the report; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md`, `report.md` and the Experiment 27 `report.md`.
- One script: `run.py`. Tests are outside the limit.
- Import the arm functions from Experiment 27 `run.py`; do not copy them. Read the Experiment 24 and 26 saved outputs only. Never write there.
- Use the embedding server on port 9931 for the 60 fresh-prompt embeddings only. No reranker, paid or web calls.
- Judge text goes to Anthropic (Claude Haiku subagents), after secret redaction. Logs hold ids and counts only.
- The operator labels nothing. All labels are AI labels, so validity stays INCONCLUSIVE.
- Stop if gate G1 or G2 fails; record it in `report.md` and ask.
