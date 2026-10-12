# Experiment 14: neighbour gate with 1 or 2 neighbours

- **Status**: FAIL (2026-10-11). Post-hoc exploratory follow-up to Experiment 12. k = 1 and k = 2 both accepted nothing.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Does the Experiment 12 neighbour gate pass Tier 1 when it needs only 1 or 2 agreeing neighbours instead of 3?
- **Files**: `report.md` holds the plan and the result; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script, `run_eval.py`. Tests are outside the limit.
- Load Experiment 12's runner read-only, pinned by SHA-256. Change only its constant `K`. Never write into Experiment 12's folder.
- Write only under this folder's `output/`, atomically. `--verify` recomputes with zero writes.
- No model calls. Log counts, identifiers and hashes only.
