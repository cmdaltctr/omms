# Experiment 12: neighbour check against reviewed members

- **Status**: FAIL (2026-10-11). Safe but starved: 1 correct, 0 wrong, 139 parked; Tier 1 needs 29 correct.
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: Can a gate that compares each observation with already-labelled observations reuse labels with zero wrong picks and at least 29 correct on the 140 test cases?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Before execution

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Planning authorises nothing. Obtain approval before implementation and before each run.
- Keep Experiments 01 to 11 and shared helpers read-only.

## Fixed comparison

- Baseline: Experiment 06 picks, all accepted. Candidate: the neighbour gate on cached Experiment 01 vectors. No model calls.
- Nested folds by group: 5 outer folds; thresholds chosen inside each outer gallery by leave-one-out; never on the case being scored.
- Ruler and acceptable sets come from Experiment 11. Tier 1 decides H1.
- The gate parks unsure cases. It never writes `none_fit` by itself. Review load is reported, not gated.

## Execution rules

- One runner, `run_eval.py`, with phases `run` and `verify`. `analysis.py` comes after results. Tests are outside the limit.
- Write only in this folder, under `output/`, atomically, checkpointing each fold, with matching `--resume`.
- Never log observation text. Log counts, identifiers and hashes.
- `--phase verify` reproduces results without writes.
- Record amendments in `plan.json` before the affected work.

## Next step

Read `report.md`. Use `run_eval.py --phase verify` for read-only reproduction. Experiment 13 is on hold until the operator chooses a next step.
