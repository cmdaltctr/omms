# Experiment 19: catalogue version 2 candidates from observations that fit no label

- **Status**: FAIL on the count rule by one (26 candidates, limit 25); coverage 147/195 passes. Operator decides per candidate.
- **Category**: review
- **Size**: Quick
- **Question**: Do the 195 no-label observations from Experiment 18 group into a small set of coherent new labels?
- **Files**: `report.md` holds the plan and the result; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script, `check_candidates.py`. Tests are outside the limit.
- Observation text stays in git-ignored `corpus/`. Tracked files hold only label names, definitions and counts.
- This experiment proposes labels. The operator accepts or rejects them. It never edits the catalogue.
- A later test of catalogue version 2 must use observations outside Experiment 18's 400.
