# Experiment 27: keyword boost against rank fusion

- **Status**: INCONCLUSIVE, G6 failed; the boost helps, RRF not shown (2026-10-18). See `report.md`.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Does the keyword boost, or reciprocal rank fusion (RRF), find more relevant memories in the top 10 than meaning alone?
- **Files**: `report.md` holds the plan and the report; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script: `run.py`. Tests are outside the limit.
- Read Experiment 24 `output/` (snapshot, `sample.json`, `pair_key.json`, `judge_labels_v2.jsonl`) only, from the saved copy in the experiment outputs folder. Never write there. Import its scoring functions; do not copy them.
- Build the keyword index in a new file under this experiment's `output/`. Never open the snapshot for writing.
- Use the embedding server on port 9931 for the 60 query embeddings only. No reranker, paid or web calls. The Claude Haiku judges below are the only other external call.
- Judge text goes to Anthropic (Claude Haiku subagents), after secret redaction. Logs hold ids and counts only.
- The operator labels nothing. All labels are AI labels, so validity stays INCONCLUSIVE.
- Stop if gate G1 or G2 fails; record it in `report.md` and ask.
