# Experiment 24: reranker for memory retrieval

- **Status**: FAIL on guardrail L, validity INCONCLUSIVE (2026-10-17). See `report.md`.
- **Category**: retrieval
- **Size**: Standard; medium statistics
- **Question**: Does a reranker over the top 50 memories find more relevant memories in the final 10 than the current scorer?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `report.md` holds the result; `CLAUDE.md` links here.

## Rules

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Scripts: `run_eval.py` (phases prepare, check, run, pool), `summarise.py` and `analysis.py`. Tests are outside the limit.
- Read the OMMS store only through a copy in `output/snapshot/`. Never open the live store for writing.
- Reuse the Experiment 18 `sign_test` and Experiment 17 server settings read-only, pinned by SHA-256.
- Own one reranker server on port 3008. Use the operator's embedding server on port 9931 only for query and G2 vectors. No downloads.
- Logs hold ids, counts and timings only. Prompt and memory text stays in `output/`.
- Stop after `--phase check` if G1 or G2 fails; record an amendment in `plan.json` and ask.
