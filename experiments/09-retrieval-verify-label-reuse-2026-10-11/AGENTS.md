# Experiment 09: verification gate before first label reuse

- **Status**: INCONCLUSIVE (AI reference); functional FAIL. Both arms failed calibration on 2026-10-11; no test inference ran.
- **Cleanup**: report accepted on 2026-10-11; the 172 MB ONNX file was deleted. `--phase verify` needs the pinned files re-downloaded to re-run. The 8.3 MB tokenizer stays, recorded by its SHA-256.
- **Category**: retrieval
- **Size**: Standard; basic statistics
- **Question**: Can a calibrated binary verification gate bring wrong reuse below 2% while retaining at least 19 correct matches?
- **Files**: `protocol.md` holds the plan; `plan.json` holds the frozen values; `CLAUDE.md` links here.

## Before execution

- Read the repository `AGENTS.md`, `../AGENTS.md` and `protocol.md`.
- Planning authorises nothing. Obtain separate approval for installs, downloads, the owned Clef server and inference.
- Keep Experiments 01 to 08 and every pinned shared helper read-only.

## Fixed comparison

- Baseline: saved Experiment 06 Qwen answers. The proposer makes no fresh calls.
- Two arms verify each of the 71 existing-label picks once: NLI ONNX and Clef yes/no.
- Thresholds are calibrated on the 60 development cases, then frozen before test inference.
- Gates G1 to G5 in `protocol.md`; wrong reuse below 2%, at least 19 correct retained, review load at most 70%.
- Failed verification routes to review. It never becomes automatic `none_fit`.
- Verifier errors stay errors. They never count as correct answers.

## Execution rules

- Allow one runner, `run_eval.py`, with phases; tests are excluded from the limit.
- Write only in this folder. Checkpoint each pair atomically under `output/` and support matching `--resume`.
- The NLI arm runs offline on CPU after the approved download. The Clef arm uses only the owned server on `127.0.0.1:3004`.
- Never log prompts or raw replies. Never make hosted calls.
- `--verify` reproduces results without inference, writes or server starts.
- Record amendments in `plan.json` before the affected work.

## Next step

Read the completed report. Use `run_eval.py --phase verify` for read-only reproduction.
Both arms failed the frozen calibration rule; further verifier work needs a new, separately approved experiment.
