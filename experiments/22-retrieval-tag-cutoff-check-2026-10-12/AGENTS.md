# Experiment 22: confidence cut-off for up to three labels per memory

- **Status**: FAIL (2026-10-12). Cut-off 0.08 passed on Experiment 18 but lost 6 points of hits on Experiment 20. Use plain top three. About 3 in 10 observations fit only a label from the other section.
- **Category**: retrieval
- **Size**: Quick
- **Question**: If OMMS tags each memory with up to three labels, can a confidence cut-off remove wrong tags without losing right ones?
- **Files**: `report.md` holds the plan and the report; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script: `cutoff_check.py`. Its test is outside the limit.
- Read Experiments 18 and 20 output read-only. Write only inside this folder's `output/`.
- No model calls.
- `corpus/multilabel-18.json` and `corpus/multilabel-20.json` hold the multi-label key (Amendment 1 in `report.md`).
