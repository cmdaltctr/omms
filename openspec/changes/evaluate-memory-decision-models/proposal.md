# Proposal

## Why

The inspected profile has 336 preferences with 331 categories and 316 patterns with 313 categories, including overlapping names and a Spanish description. We need controlled evidence before choosing a model for category reuse or prompt-aware context selection.

Duplicate and conflict checks also merge profile entries, and they are slow in long imports. A profile-only import made 60 duplicate-check calls to the current model in four batches. We need evidence on whether a decision model can make these yes/no checks as safely as the current one, and how much time it saves.

## What Changes

- Add `experiments/EXP_README.md` and separate dated protocols for label decisions, retrieval decisions and pair (duplicate and conflict) decisions.
- Implement offline evaluation runners after proposal approval, using read-only snapshots, reviewed ground truth and frozen test sets.
- Compare normalisation and embedding controls with the current language model, Jev and Julia-1 under matched inputs.
- Keep OpenJev optional until its exact repository, backend, weights and licence are recorded.
- Record cost, latency, failed cases, confidence calibration and independent PASS, FAIL or INCONCLUSIVE results.
- Require separate approval for installations, model downloads, hosted data transfer and spending limits.

The planning deliverables are:

- [Label protocol](../../../experiments/01-label-decisions-2026-10-07/protocol.md): 200 reviewed cases; category selection without entry merging.
- [Retrieval protocol](../../../experiments/02-retrieval-decisions-2026-10-07/protocol.md): 100 reviewed requests; evidence selection under a fixed context budget.
- [Pair protocol](../../../experiments/03-pair-decisions-2026-10-10/protocol.md): 200 duplicate pairs and 150 conflict pairs, reviewed blind; yes/no answers judged on copies by false-merge rate and decision time.

Production relabelling, translation, performing or changing entry merges, coloured badges, live retrieval changes and integrating Jev are outside this change. Experiment 03 judges yes/no pair answers on copies and merges nothing. A passing experiment supports a later proposal; it cannot enable a production feature.

## Capabilities

### New Capabilities

None in the production memory system. This change adds experiment tooling and records its evaluation plan.

### Modified Capabilities

None. `profile-learning`, `memory-context-controls` and host contracts remain unchanged. The change sets `skip_specs: true` because experiment tooling does not change their requirements.

## Impact

- New files live under `experiments/`; Python dependencies stay in an experiment-only `uv` environment.
- Bun fixture helpers may call existing TypeScript ranking and packing services against isolated storage.
- Live OMMS stores, configuration and host histories remain untouched. Personal corpus files and results stay locally under ignored paths.
- The published package has no new dependency or API. Its existing `files` list excludes `experiments/`.
- No production provider is selected by this proposal.

Planning is complete when all three protocols, the design and tasks are saved, formatted and strictly validated. Runners and model evaluations remain pending approval.
