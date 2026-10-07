## Context

`decayItems` in `src/services/user-profile/user-profile-manager.ts` runs one rule for preferences, patterns and workflows: remove an item when its age is above `userProfileStaleDays` and its evidence count is below `userProfileMinEvidenceForRetention`. The OpenCode idle path and the web profile API call it through `decayInMemory`. The Pi path does not call decay.

The analysis prompt in `src/core/profile-analysis.ts` asks for `description` and `steps` only for workflows. So `initItem` stores `evidence: []`, and a match in `mergeItems` adds no evidence. A workflow's `frequency` does rise by 1 on each strong match.

`importProfileFromHistory` in `src/importer/profile-import.ts` writes a ledger row `<unit key>#profile` for each recorded prompt and skips any row with status `imported`. `--force` reaches `importer.ts` and `opencode-import.ts` for memory units only. The cleanup service deletes old rows from `user_prompts`, so the analysed text exists only in the host history files.

Live data on 7 October 2026: 4,164 `#profile` ledger rows marked `imported`, 31 rows in `user_prompts`, 4 workflows in the profile.

## Goals / Non-Goals

**Goals:**

- Keep workflows long enough to be matched again.
- Let the user rebuild the profile from history they already imported.
- Keep host parity with no adapter changes.

**Non-Goals:**

- Change the analysis prompt or add evidence to workflows.
- Change the rule or defaults for preferences and patterns.
- Change the profile catch-up command or the live learning path.
- Remove duplicate workflows that a rebuild may create. The existing deduplication in `mergeItems` handles them.

## Decisions

### Workflow support uses frequency

Decay computes `support = max(evidenceCount, frequency ?? 1)` for workflows and compares it with `userProfileMinEvidenceForRetention`.

Alternative: add `evidence` to the workflow schema in the prompt. It changes the model contract for every host and does nothing for workflows already stored. Frequency already counts repeat sightings, so it is the smaller change.

### A separate stale window for workflows

New config key `userProfileWorkflowStaleDays`, default 30, read with `?? 30` so the partial `CONFIG` stubs in tests still work. A workflow repeats less often than a preference, so it needs a longer window. Keeping the key separate leaves the preference and pattern rule unchanged.

`decayItems` takes the item type as a parameter. It already receives one list per type from `decayInMemory`.

### `--force` covers profile prompts

`--force` already means "reprocess units with final ledger states". The profile import now honours it too: with `force`, a `#profile` row marked `imported` is processed again. `--force --skip-memories` gives a profile-only rebuild. `--force --skip-profile` keeps the old memory-only behaviour.

Alternative: a new flag such as `--reanalyse-profile`. It adds a fourth profile flag to the parser, help text, web form and three guides. Reusing `--force` needs only a pass-through.

### Mark an existing prompt as waiting again

`savePrompt` deduplicates on `(session_id, message_id)` and returns the existing row ID. For a forced unit, the import then calls a new `userPromptManager.markForUserLearning(promptId)`, which sets `user_learning_captured = 0`. A deleted prompt gets a new row, which starts as waiting. The ledger row stays `imported` and gets the new prompt ID through `ledger.complete`.

### Dry run

A forced dry run counts `imported` profile rows as `promptsWouldRecord`, not `promptsAlreadyHandled`. It reads the ledger with `peek` as it does now and writes nothing.

## Risks / Trade-offs

- [A user who already passes `--force` now also re-sends profile prompts] → Document it in the CLI guide and the three import guides. `--skip-profile` restores the old run. The dry run shows the profile count first.
- [Each forced rebuild raises the `frequency` of matched items] → A rebuild is a one-off action, and the docs say so. Higher frequency makes items last longer, which is the aim.
- [A rebuild of 4,164 prompts costs about 84 model calls] → Batches of 50 by default, trivial prompts skipped, and the dry run reports the count.
- [Workflows grow without limit] → Display and injection already cap the list (`userProfileInjectWorkflows`). Workflows seen once still go after 30 days.

## Migration Plan

No data migration. Existing workflows get the new rule on the next decay pass. To rebuild, the user runs each host import with `--force --skip-memories`, after a `--dry-run`. Rollback: revert the change. Workflows kept by the new rule then fall under the old rule on the next decay pass.
