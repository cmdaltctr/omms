# Experiment 18: fresh-data confirmation of cosine, reranker and Clef together

- **Status**: PLANNED (2026-10-12). Confirmatory: the plan is committed before selection, labelling or any model run.
- **Category**: retrieval
- **Size**: Confirmatory; expert statistics
- **Question**: Do the Experiment 17 findings hold on 400 fresh observations: three methods' picks together contain the right label, and their agreement marks a right label?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Scripts: `select_cases.py`, `finalise_reference.py`, `run_eval.py`, `analysis.py`. Tests are outside the limit.
- Selected text stays in the git-ignored `corpus/`. Never put observation text in a tracked file or a log.
- Labelling agents read only `corpus/label-input.json`. They never see model outputs, scores or the old reference.
- Freeze the reference by SHA-256 before the first model call. `run_eval.py` refuses to start without it.
- Reuse Experiments 12, 15, 16 and 17 runners read-only, pinned. Own one server at a time: ports 3007, 3008 and 3005.
- `--phase verify` recomputes from saved answers, without servers and without writes.
- Record amendments in `plan.json` before the affected work.
