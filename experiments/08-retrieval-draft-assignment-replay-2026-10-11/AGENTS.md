# Experiment 08: AI-drafted assignment replay

Read repository `AGENTS.md`, `../AGENTS.md` and this folder's `report.md` before work.
Verify the worktree root and branch before writes or execution.

## Fixed scope

- Quick scope is selected. The user authorised AI drafting and this small offline follow-up.
- Use one Python runner, `run_eval.py`, with focused tests excluded from the script limit.
- Freeze the plan and drafts before replay. Preserve the planning half after execution.
- Keep experiments 01–07 and shared helpers read-only. Record preservation hashes before execution.
- Use saved Experiment 05 responses. Make zero fresh inference calls.
- Run ten empty-history seed queries, ten exact repeats and ten unseen queries in that order.
- Admit only eligible experimental draft assignments under Experiment 07's scoped exact policy.
- Keep `none_fit` uncached. Add no catalogue IDs or extraction changes.

## Provenance and execution

- Every draft has `human_reviewed: false` and `provenance: AI_draft`.
- Execution authorisation does not adjudicate individual categories. Never record these fixtures as real human approvals.
- Keep draft decisions separate from original evaluation answers. Validity stays INCONCLUSIVE.
- Preserve complete saved outcomes on misses, including errors and statuses.
- Save raw query rows and checkpoints atomically under `output/`; resume only with matching frozen inputs.
- Make `--verify` read-only. Prove focused tests detect broken source logic using disposable copies.
- Report functional gates separately from label validity. Results cannot approve production changes.
- Exclude installs, downloads, model servers, private history, production mutation, commits and pushes.
