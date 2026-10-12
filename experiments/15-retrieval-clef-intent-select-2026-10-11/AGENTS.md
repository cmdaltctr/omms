# Experiment 15: Clef selects the intent label, with retrieved examples and shuffled order

- **Status**: FAIL (2026-10-11). Safe but starved: Clef never reached 0.9, so 0 accepted. Best possible zero-wrong cut-off on test answers keeps 9 correct; Tier 1 needs 29.
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: Can Clef, choosing among every same-section label with its definition and closest past examples, reuse labels with zero wrong picks and at least 29 correct, under two option orders?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- One runner, `run_eval.py`, with phases `run` and `verify`. `analysis.py` after results. Tests are outside the limit.
- Load Experiment 12's runner read-only, pinned by SHA-256. Never write outside this folder's `output/`.
- Own one Clef server on `127.0.0.1:3005`; refuse an occupied port; stop only the owned child.
- Checkpoint each call atomically with matching `--resume`. Never log prompts or replies. No hosted calls.
- `--phase verify` recomputes decisions from saved replies, without a server and without writes.
- Record amendments in `plan.json` before the affected work.
