# TDR-052: Item matching broke when a save rewrote a category spelling

**Date:** 2026-10-17
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** profile, user-profile, categories, undo, apply, tests

## Context

The automatic profile cleanup (ADR-030) stores the items it merges or removes, and Undo finds them again later. AI Cleanup's Apply (ADR-029) also finds items again in a profile that learning has saved to since the job read it. Both find an item by its section, category, description and, for workflows, steps.

### Root Cause Analysis

Every profile save runs `canonicaliseCategories` (`src/services/user-profile/profile-category.ts`). It keeps one visible spelling for each category, chosen by count, and rewrites every item that uses another spelling. A merged item written as `git_workflow` can be stored as `Git workflow` after the next save. The identity key (`profileItemIdentityKey`) compared the category text exactly, so:

- Undo did not find the merged item, reported "not found" and restored nothing.
- Undo did not see that a removed original was already back under another spelling, and added a second copy.
- Apply skipped a ticked change when a save during the run had rewritten the spelling of one of its items.

Task 2.4 of the change looked for this on purpose. Four tests failed first: two on the pure undo function, one on Apply, and one that saves through the real profile manager and undoes afterwards.

## Decision

`profileItemIdentityKey` compares the category by `categoryKey`, the same key the save uses. The key ignores case, spacing, hyphens and underscores. Apply and Undo share the function, so both follow the rule.

Two spellings that mean the same category now count as the same item. A rename to a different name (for example by Clean up categories) is still not found, and Undo says so.

## Also found: a code default can be hidden by the config template

While changing the default of `userProfileAutoCleanupInterval` from 100 to 500, a mutation check put the old value back in `DEFAULTS` in `src/config.ts`. Every test still passed. When no config file exists, OMMS writes one from `CONFIG_TEMPLATE` and reads it back, so the template value hides `DEFAULTS`. A user whose file exists but has no such key gets `DEFAULTS`, and nothing tested that. `tests/omms-config.test.ts` now has a test with an existing file that has no cleanup keys.

When you change a default, check both places, and test an existing config file without the key.

## Consequences

### Positive

- Undo and Apply keep working after the save rewrites a spelling.
- No duplicate item comes back after an Undo.

### Negative

- Two items whose categories differ only by case, spacing, hyphens or underscores now have the same identity. The save already treats them as one category, so this matches stored data.

### Neutral

- The identity key still leaves out counters, evidence and vectors.

## How to Recognise / Handle This Again

1. Undo reports many changes as "not found" right after a run, with no category cleanup in between.
2. Check whether the stored category of the merged item differs from the one in the restore record only by case, spacing, hyphens or underscores.
3. Any new code that finds a profile item again after a save must compare the category by `categoryKey`.

## Revisit Triggers

- A change to `canonicaliseCategories` or `categoryKey`.
- A change that lets a save rewrite another field of an item, such as the description.

## References

- `openspec/changes/archive/2026-10-17-auto-profile-cleanup-all-hosts/`
- [ADR-029](../adr/029-ai-cleanup-runs-as-a-batched-job.md), [ADR-030](../adr/030-profile-cleanup-runs-on-every-host.md)
- `tests/ai-cleanup-undo.test.ts`, `tests/auto-cleanup-handlers.test.ts`, `tests/ai-cleanup-apply-edits.test.ts`, `tests/omms-config.test.ts`
