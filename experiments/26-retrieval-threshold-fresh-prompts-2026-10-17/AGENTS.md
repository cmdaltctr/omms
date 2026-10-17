# Experiment 26: threshold check on fresh prompts

- **Status**: INCONCLUSIVE, G5 failed; H1 holds on every key (2026-10-17). See `report.md`.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Does the Experiment 25 threshold result hold on prompts that no earlier experiment used?
- **Files**: `report.md` holds the plan and the report; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script: `run.py`. Tests are outside the limit.
- Read Experiment 24 `output/` (snapshot, `sample.json`) only. Never write there. Import its scoring functions and Experiment 25 `evaluate`; do not copy them.
- Use the operator's embedding server on port 9931 for the 60 query embeddings only. No reranker, paid or web calls.
- Judge text goes to Anthropic (Claude Haiku subagents), after secret redaction. Logs hold ids and counts only.
- Stop if gate G1 or G2 fails; record it in `report.md` and ask.
