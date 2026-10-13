# Experiment 05: Qwen label decisions

- **Alias**: Experiment 1b
- **Status**: INCONCLUSIVE; functional gates FAIL (2026-10-10)
- **Category**: retrieval
- **Size**: Quick; basic statistics
- **Question**: Can Qwen3-0.6B reuse labels safely while retaining useful correct matches compared with Clef?
- **Files**: Plan and results in report.md; CLAUDE.md links here.

## Before execution

- Read repository AGENTS.md, experiments/AGENTS.md and report.md.
- Execution approved and completed. Obtain approval before any additional inference.
- Use the normal llama.cpp cache; no downloads, model copies, installs or runtime updates.
- Require the pinned model, launcher, corpus and saved Clef hashes.

## Fixed comparison

- Qwen3-0.6B Q8_0, thinking disabled, direct label or none_fit; one Qwen arm.
- Use the same 140 test cases, candidate definitions and ordered options.
- Compare against saved unfiltered Clef answers. Make no fresh Clef calls.
- Require valid outcomes for all cases, E > 0, W/E < 0.02 and C >= 19.
- Invalid responses require review; they never count as correct none_fit.
- Exclude threshold searches, second verification passes and other models.
- Report functional gates plainly. Keep AI-reference validity INCONCLUSIVE separately.

## Execution rules

- Allow one Python script, run_eval.py; tests are excluded.
- Start only an owned loopback server on an unused port 3003; stop only that child.
- Keep the embedding server, old experiments, shared helpers and .env unchanged.
- Write atomic checkpoints under output/ and resume only with matching hashes.
- Never log prompts or raw replies. Never make hosted calls.
- Verify without writes, HTTP calls or server startup.
- Record amendments before affected work. Preserve the approved plan.

## Next step

Read the completed report. Verify saved results with run_eval.py --verify; do not rerun inference automatically.
