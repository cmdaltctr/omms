# Design

## Context

Workflows go through the same `mergeItems` path as preferences and patterns in `src/services/user-profile/user-profile-manager.ts`. That path was written for items that have a `category`. Workflows have none, so the check `existing.category === newItem.category` compares `undefined` with `undefined` and is always true.

The effects, found in the live store (4,000+ memories, 5,328 prompts analysed):

1. Every workflow pair counts as "same category". The weak similarity band (0.5) applies, and so does the pass that folds neighbours scoring 0.8 or more into the matched entry. Two real workflows each carry an `alpha` of about 100, which is weight folded in from other entries.
2. `mergeConfirmedMatch` replaces `steps` with the incoming steps on every match. The entry with frequency 518 holds the steps of whichever workflow matched last.
3. At milestone frequencies the description rewrite asks for "the user's general behavioural tendency". For a workflow this produces a persona summary. That summary has a broad embedding, so it matches more things.
4. The analysis prompt never defines a workflow, and the schema accepts an empty `steps` array.

## Goals / Non-Goals

**Goals:**

- New workflows stay separate entries unless they closely match one.
- Workflow descriptions and steps stay concrete.

**Non-Goals:**

- No change to preferences or patterns.
- No new config keys. Existing thresholds are reused.
- No automatic repair of stored profiles. The one bad entry is removed by hand (tasks, group 5).
- No change to `deduplicateItems` or `detectConflicts`. Deduplication merges a pair only when the model confirms a duplicate, with at most 5 calls per pass, so it is not the cause. Task 1.4 records this.

## Decisions

**Branch on `itemType === "workflow"` inside the existing merge code.** A workflow takes the strong band only, skips the neighbour-fold pass, and skips the description rewrite. Alternative: give workflows a synthetic category. Rejected, because the category compare is the wrong test for items that have no category, and a synthetic value hides that.

**Filter short workflows in `mergeProfileData`, after the model reply.** Every host reaches `mergeProfileData`. OpenCode builds its own prompts and does not call `analyzeProfile`, so a filter there would miss it. Alternative: tighten the zod schema with `min(3)`. Rejected, because one short workflow would fail the whole reply, and with it the preferences and patterns.

**One shared definition of a workflow.** `WORKFLOW_PROMPT_RULES` and `MIN_WORKFLOW_STEPS` live in `src/core/extraction.ts` and go into all three profile prompts (the analysis port and both OpenCode prompts).

**Minimum of 3 steps.** The four real workflows in the store have 3, 4, 5, and 8 steps. A fixed constant in the module, with no config key.

**Replace steps only with a longer list.** This keeps the fullest known version of a workflow. Alternative: merge step lists. Rejected as speculative, because step order cannot be merged without a model call.

**Warm up in the CLI import branch, as the Pi, OpenCode, and web import paths already do.** `mergeItems` reads `isWarmedUp` and never starts a warm-up. A memory import warms the service by embedding through the store. A profile-only import (`--skip-memories`) never does, so 52 of 56 batches in the live rebuild ran cold. The warm-up is best-effort: a failure prints a warning and the import continues. It is skipped for dry runs and for `--skip-profile`. Alternative: warm up inside `mergeItems`. Rejected for this change, because it alters every caller. `profile-catch-up` has the same gap and gets the same best-effort warm-up after the model is selected.

**Keep the new logic in pure functions** (`hasEnoughWorkflowSteps` in `src/core/extraction.ts`) and the tests free of `CONFIG` stubs where possible. The merge tests set only the threshold keys they need on the real `CONFIG`.

## Risks / Trade-offs

- Fewer merges means more near-duplicate workflows. The existing deduplication pass and the 30-day retention rule limit this. Accepted as a known cost.
- A stricter prompt on a cheaper model (DeepSeek Flash) may return fewer workflows. The live check in task 5.3 measures the result.
- A warm profile merge embeds every finding and compares it with every stored item. In the live rebuild a batch took about 4 minutes, against about 20 seconds when cold. A full rebuild of 2,800 prompts takes about 3.5 hours. Accepted: the cold path lost data.
- Entries already stored are not repaired by code. Until task 5.1 runs, the inflated entry keeps matching strong hits.
