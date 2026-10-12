# Experiment 23: all label methods, one section against both sections

- **Status**: PLANNED (2026-10-12). Plan only; nothing has run.
- **Category**: retrieval
- **Size**: Standard; medium statistics
- **Question**: Which method gives the best three tags per memory, and does choosing from both sections (preferences and patterns) help?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Scripts: `run_eval.py` (phases check, run, verify) and `analysis.py`. Tests are outside the limit.
- Reuse Experiments 15, 17, 18 and 20 runners read-only, pinned by SHA-256. Never write outside this folder's `output/`.
- Own one server at a time: reranker on port 3008, Clef on port 3005. No embedding, paid or web calls; no downloads.
- Observation text goes only to the local servers. Logs hold ids and counts only.
- Stop after `--phase check` if G2 or G3 fails; record an amendment in `plan.json` and ask.
- Do not run until the operator approves.
