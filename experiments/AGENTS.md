# Experiments: rules for every agent

## Before you start

- Read the repository AGENTS.md first. It wins on code paths and settings.
- Load the current s-experiment skill and read EXP_README.md.
- Read the experiment folder's AGENTS.md and plan before working there.
- Verify the worktree root and branch before changing files or running commands.

## Plan an experiment

- One experiment answers one question about one change against one baseline.
- Use the next free index number. Never reuse a number or rename old folders.
- Name new folders `<N>-<category>-<slug>-<YYYY-MM-DD>`.
- Categories: retrieval, ingestion, runtime, generation, graph, review.
- Ask the user to choose Quick, Standard or Confirmatory.
- Quick: put the plan at the top of report.md; allow one Python script.
- Standard: add protocol.md and plan.json; allow three Python scripts.
- Confirmatory: use the Standard files; allow five Python scripts and freeze the plan in an approved commit.
- Tests do not count towards script limits.
- Add folder AGENTS.md and a CLAUDE.md symlink to it. Add a PLANNED index entry.
- Fix the hypothesis, null, inputs, score definition, thresholds and decision rule before running.
- Obtain approval before implementation or execution. Planning alone authorises neither.

## Run safely

- Keep earlier experiments, results and pinned shared helpers read-only.
- Write only inside the current experiment folder, except authorised index updates.
- Never change production stores, host histories or .env.
- Ask before installs, downloads, inference, model restarts, commits, pushes or full test suites.
- Save raw results under output/ atomically. Checkpoint each cell and support matching resume.
- Record plan amendments before affected work. Preserve the original plan.
- Use existing shared statistics helpers when available. Ask before adding shared scaffolding.

## Report

- Start report.md with the question, answer, decision, confidence and next step.
- Cite output files for numerical results. Use plain British English.
- Report failures, undefined rates and limitations. Empty acceptance cannot establish safety.
- Keep review abstention separate from correct answers and explicit none_fit.
- Label rescoring of inspected results as post-hoc exploratory work.
- AI-only reference labels leave validity INCONCLUSIVE. Results cannot approve production changes.
- Update folder status and the index only when supported by completed work.
