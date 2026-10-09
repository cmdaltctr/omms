# TDR-040: Workflows collapsed into one entry

**Date:** 2026-10-09
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** user-profile, workflows, merge

## Context

A profile built from 5,328 prompts held 5 workflows. One had a frequency of 518 and a description that read as a personality summary. In one day's log, 117 of about 119 workflow matches went to that entry.

### Root Cause Analysis

Four causes combined:

1. Workflows have no `category`. The check `existing.category === newItem.category` compared `undefined` with `undefined`, so every pair counted as the same category. That applied the weak similarity band (0.5), the three-way merge, and the pass that folds neighbours scoring 0.8 or more into the matched entry.
2. `mergeConfirmedMatch` replaced `steps` with the incoming steps on every match, so the stored steps came from whichever workflow matched last.
3. The description rewrite at milestone frequencies asks for the user's "general behavioural tendency". For a workflow, that produced a persona summary with a broad embedding, which then matched more items.
4. A profile-only terminal import (`--skip-memories`) never warmed the embedding service. `mergeItems` reads `isWarmedUp` without starting a warm-up, so findings went to a cold buffer capped at 50 per type, and the overflow was lost. In the first rebuild, 52 of 56 workflow merges ran cold and the profile did not grow.
5. The analysis prompts never defined a workflow, and the schema accepted an empty `steps` list.

## Decision

- A workflow takes only the strong similarity band. It skips the three-way merge and the neighbour fold.
- A match replaces steps only with a longer list.
- `evolveAndUpdate` returns early for workflows.
- `WORKFLOW_PROMPT_RULES` and `MIN_WORKFLOW_STEPS` in `src/core/extraction.ts` define a workflow in all three profile prompts (analysis port and both OpenCode prompts).
- `mergeProfileData` drops incoming workflows with fewer than 3 non-empty steps.
- `createProfile` applies the same filter. A first profile never passes through `mergeProfileData` (`profile-backlog.ts`, the Pi, Claude Code and OpenCode paths, and the manual write all call `createProfile` directly), so the filter in `mergeProfileData` alone left a gap. `updateProfile` is not filtered, because it also saves manual edits and decay.
- The terminal import in `src/cli/index.ts` warms the embedding service before it starts, as the Pi, OpenCode, and web import paths do. `profile-catch-up` does the same. A failed warm-up prints a warning and the import continues.
- Tests: `tests/profile-workflow-merge.test.ts` (including the first-profile case), `tests/profile-workflow-prompt.test.ts`, `tests/cli-import-warmup.test.ts`, `tests/profile-catch-up-command.test.ts`.

## Consequences

### Positive

- New workflows stay separate entries. The weak-band test reproduced the bug: 8 unrelated workflows folded into one entry with frequency 9.
- Pi, OpenCode, and Claude Code share one rule.

### Negative

- More near-duplicate workflows can appear. Model-confirmed deduplication (5 calls per pass) and the 30-day retention rule limit this.
- A warm merge is slow: about 4 minutes per batch of 50 prompts in the live rebuild, against about 20 seconds cold. A full rebuild of 2,800 prompts takes about 3.5 hours.
- Stored profiles are not repaired by code. An entry that is already inflated keeps its frequency until it is removed by hand.
- A stricter prompt on a small model can return fewer workflows.

### Neutral

- `deduplicateItems` still merges workflows when the model confirms a duplicate. It is unchanged.

## Alternatives Considered

| Option                              | Rejected Because                                                      |
| ----------------------------------- | --------------------------------------------------------------------- |
| Give workflows a synthetic category | Hides the wrong test instead of fixing it.                            |
| `min(3)` on the zod schema          | One short workflow would fail the whole reply, including preferences. |
| Filter inside `analyzeProfile` only | OpenCode builds its own prompts and does not call `analyzeProfile`.   |
| Merge step lists on a match         | Step order cannot be merged without a model call. Speculative.        |

## Corrections

- The design of the archived change `fix-workflow-merging` says every host reaches `mergeProfileData`. That is wrong for the first profile. Found by `openspec-verify-change` on 2026-10-09 and fixed in `createProfile`. The archived design is left as written.
