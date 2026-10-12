# Experiment 13: compare check with Clef, agreeing with the neighbours

- **Status**: WITHDRAWN without a run (2026-10-11). Experiment 12 showed the nearest-neighbour label is acceptable for only 32 of 67 labelled cases, capping this design at 32 correct. The operator chose review-first assignment instead (ADR-024).
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: Does asking Clef to choose between the two closest labels, shown with their past examples, keep more correct matches than the neighbour gate alone, still with zero wrong picks?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Before execution

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Planning authorises nothing. Obtain separate approval for implementation, the owned Clef server and the 280 calls.
- Pin Experiment 12's `output/folds.json` and `output/predictions.json` as amendment 1 before any call.
- Keep Experiments 01 to 12 and shared helpers read-only.

## Fixed comparison

- Baseline: Experiment 12's neighbour gate decisions on the same 140 cases.
- Candidate: the closest-neighbour label, accepted only when Clef picks it in both A/B orders with probability at least 0.9.
- Cut-off 0.9 is fixed before any call. Other cut-offs are exploratory only.
- The gate parks unsure cases and never writes `none_fit` by itself.

## Execution rules

- One runner, `run_eval.py`, with phases `run` and `verify`. `analysis.py` comes after results. Tests are outside the limit.
- The runner owns one Clef server on `127.0.0.1:3005`, refuses an occupied port, and stops only its own child.
- Checkpoint each call atomically under `output/`, with matching `--resume`.
- Never log prompts or replies. No hosted calls.
- `--phase verify` reproduces results without a server and without writes.
- Record amendments in `plan.json` before the affected work.

## Next step

None. Any future compare check needs a new experiment and a new plan.
