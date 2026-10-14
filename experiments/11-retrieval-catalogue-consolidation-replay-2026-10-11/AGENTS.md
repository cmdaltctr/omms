# Experiment 11: catalogue consolidation replay and the new scoring ruler

- **Status**: FAIL (2026-10-11). H1 does not hold: 1 of 13 label-versus-label wrong picks fixed at L20; 7 needed. Post-hoc exploratory.
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: How much of Experiment 06's wrong label reuse disappears when confusable labels merge into a smaller catalogue built from development evidence only?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Before execution

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Planning authorises nothing. Obtain approval before implementation and before each run.
- Keep Experiments 01 to 10 and shared helpers read-only.

## Fixed comparison

- Baseline: saved Experiment 06 Qwen answers, scored on the Experiment 10 reference. No model calls.
- Five paired cells on the same 140 cases: C0 single reference, C1 acceptable-label sets, C2 to C4 merge maps L30, L20 and L12.
- Merge maps come from Experiment 09 Clef development scores only. The build phase never reads test records.
- The ruler in `plan.json` (`ruler`) replaces the flat 2% gate from this experiment onwards.

## Execution rules

- One runner, `run_eval.py`, with phases `build`, `score` and `verify`. `analysis.py` comes after results. Tests are outside the limit.
- Freeze the build outputs by SHA-256 in the manifest before the score phase.
- Write only in this folder, under `output/`, atomically, with matching `--resume`.
- Never log observation text. Log counts, identifiers and hashes.
- `--phase verify` reproduces results without writes.
- Record amendments in `plan.json` before the affected work.

## Next step

Read `report.md`. Use `run_eval.py --phase verify` for read-only reproduction. Experiment 12 keeps 41 labels and uses the ruler in `plan.json`.
