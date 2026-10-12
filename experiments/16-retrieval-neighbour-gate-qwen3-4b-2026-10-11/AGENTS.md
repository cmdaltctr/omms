# Experiment 16: neighbour gate with the larger Qwen3 4B embedder

- **Status**: FAIL (2026-10-11). Post-hoc exploratory. Plain 4B accepted nothing; with the intent instruction it accepted 1 pick, which was wrong.
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Does Experiment 12's neighbour gate pass Tier 1 with `qwen3-embedding:4b`, plain or with an intent instruction?
- **Files**: `report.md` holds the plan and the result; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `report.md`.
- One script, `run_eval.py`. Tests are outside the limit.
- The operator approved the 4.28 GB Q8_0 GGUF download on 2026-10-11.
- Embed through this experiment's own llama.cpp b11510 server on `127.0.0.1:3007` only. Save vectors under `output/` and pin them by SHA-256.
- Load Experiment 12's runner read-only, pinned. Replace only its vector loader per cell. Never write outside this folder's `output/`.
- `--verify` recomputes from saved vectors, with no model calls and no writes.
