# Experiment 20: catalogue version 2 and Clef top-three suggestions on new observations

- **Status**: H1 PASS (no-label share 33.3%, was 49.7%); H2 FAIL (Clef top three 87.5%, mark 90%) (2026-10-12).
- **Category**: retrieval
- **Size**: Standard; medium statistics
- **Question**: On 200 observations never used before, does catalogue version 2 leave fewer observations without a label, and does Clef's top three still contain the right label?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Scripts: `prepare.py`, `run_eval.py`, `analysis.py`. Tests are outside the limit.
- Reuse Experiment 18's pinned scripts read-only. Never write outside this folder's `output/` and `corpus/`.
- Observation text stays in git-ignored `corpus/`. Labellers read only `corpus/label-input.json`.
- Freeze the reference before the first Clef call. `run_eval.py` refuses to start without it.
