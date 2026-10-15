# TDR-048: Category cleanup reuses model answers between previews

**Date:** 2026-10-15
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** profile-learning, categories, smart-category-cleanup, model-call-budget

## Context

A preview asked the profile model about every group each time. On a profile of 1,844 names it took about 16 calls of up to 180 seconds each (TDR-044). A rebuild after learning, a restart or a timed-out batch repeated all of it. The last live preview left 120 of 304 groups unchecked because 6 batches timed out, and a rebuild would have repeated the 10 batches that worked.

## Decision

Save the model's answer for a group (the names it kept and the proposed name) in `profile_category_verdicts` in `user-profiles.db`, right after its batch returns. The key is the profile id and the group id. The group id is a hash of the sorted label keys, so the same set of names always gets the same id.

A new preview groups the current names again, deletes answers older than 30 days or for groups that no longer exist, and asks the model only about groups without a saved answer. A saved answer goes through the same reply check as a fresh one, so a kept name that no longer exists in the group is removed and a group left with fewer than two names is dropped. A failed batch, a missing reply or no model saves nothing, so the next preview retries exactly those groups.

I rejected keying by the full prompt text. The example descriptions in it change on every learning run, so nearly every saved answer would stop matching.

The table holds category names only. It holds no example descriptions, prompts or raw replies. The log holds counts and phase times (`embedMs`, `groupMs`, `checkMs`, `reusedGroups`, `sentGroups`).

## Consequences

### Positive

- A rebuild costs one call per 20 new or failed groups.
- A restart keeps the batches that returned.

### Negative

- A saved name can be stale after a change of profile model. The user reviews every name, and answers expire after 30 days.
- After an undo, a preview that ran in between has deleted the answers of the restored names, so the model is asked again about them.
- There is no control to force a full re-check.
