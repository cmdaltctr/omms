# TDR-044: Category cleanup threshold and model pace

- **Date:** 2026-10-13
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Tags:** profile-learning, categories, smart-category-cleanup, model-call-budget

## Context

`smart-category-cleanup` groups profile category names by meaning and lets the profile model check each group. The design set a grouping threshold of 0.80 and reused the 60-second profile cleanup time limit. Both were untested. Task 5.2 asked for a preview on the live profile before any live apply.

All runs used a copy of the live profile database in a sandbox home folder. Nothing was applied to the live profile.

### Measurements

The live profile held 1,724 distinct category names for 1,970 preferences and patterns.

| Threshold | Groups | Categories after | Largest group | Grouping time |
| --------- | -----: | ---------------: | ------------: | ------------: |
| 0.70      |    337 |              589 |            39 |         175 s |
| 0.72      |    342 |              691 |            34 |         190 s |
| 0.75      |    362 |              867 |            24 |         106 s |
| 0.78      |    329 |            1,051 |            16 |          29 s |
| 0.80      |    294 |            1,178 |            13 |           6 s |

The embedder places same-meaning names close together but not by much: "Execution" and "Direct execution" scored 0.763, "Release workflow" and "Release process" 0.796, while the unrelated "Execution" and "Testing" scored 0.677.

The profile model was GLM through the external API. It is a reasoning model.

- With the 60-second limit, 13 of 15 batches of 20 groups timed out. The preview took 873 seconds.
- One call took about 110 seconds and about 5,000 reasoning tokens, for 5 groups and for 10 groups alike.
- Five parallel calls with a 180-second limit: three timed out, then the provider refused further calls within half a second.
- With the provider's thinking switched off, one batch of 20 groups took 36 seconds and every group was checked.

Where the model answered, it kept 104 of 120 groups, renamed 37 of them (for example "Root cause first" for "Root cause before change" and its variants), and removed stray names from 13.

### Live apply (2026-10-13)

A read-only preview on the live profile took 1,954 seconds: 295 groups, 23 dropped by the model, 232 checked, 40 unchecked after two batches timed out. The operator applied only the 232 checked groups, with "Prioritisation" in British spelling, after a database backup (`user-profiles.db.bak-category-cleanup-20261013`). The apply renamed 510 items: categories fell from 1,738 to 1,292 while items stayed at 1,988. The undo record holds 510 renames.

### Recount (2026-10-16)

A read-only recount three days later found 2,116 items and 1,849 categories, more than before the apply. 490 of the 510 renamed items had their old category again. The cleanup did not fail. A Claude Code learning run that loaded the profile at 09:48 saved that copy at 10:29, eight minutes after the apply, and replaced the renames. [TDR-050](050-profile-saves-lost-to-stale-learning-copy.md) gives the evidence and the fix. The threshold and model pace in this record are unaffected.

## Decision

- Keep the grouping threshold at 0.80. It takes the live profile from 1,724 to about 1,180 categories, keeps groups small, and groups in seconds. Lower thresholds group more names but build larger groups and take minutes.
- Call the profile model one batch at a time, with 180 seconds per call.
- Build the web preview as a background job with progress. A preview of 291 groups needs 15 calls, about 27 minutes with this reasoning model, and the Node web server ends requests after about 5.5 minutes.
- Document `memoryExtraParams` for switching a provider's thinking off. Do not set it by default: it applies to every external API call.

## Consequences

### Positive

- The model check completes on providers that refuse parallel calls.
- The user sees progress and can leave the dialog while the job runs.

### Negative

- A full preview with a reasoning model takes about half an hour.
- A web app restart drops a running job.

### Neutral

- The threshold stays a named constant; a later change can lower it with evidence.

## Alternatives Considered

| Option                                  | Rejected Because                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| **Five parallel calls**                 | The provider timed out and then refused calls                                       |
| **Show groups without the model check** | The check renamed 37 of 104 groups and removed stray names from 13                  |
| **Threshold 0.75**                      | Larger groups (up to 24 names) and 106 seconds of grouping, before any model call   |
| **Switch thinking off by default**      | Provider-specific, and it changes every external API call, including memory capture |

## How to Recognise / Handle This Again

1. Log lines `category cleanup: model batch failed` with `TimeoutError` mean the model is slower than the limit.
2. Instant `Error` failures after a few calls suggest the provider refuses parallel or rapid calls.
3. Check the provider's reasoning settings before raising limits further.

## Revisit Triggers

- A host model registers for profile calls and proves faster or slower.
- Users report cleanup groups that are too broad or too narrow.

## Verification

- `tests/category-cleanup-naming.test.ts`, `tests/category-cleanup-job.test.ts` and `tests/category-cleanup-api.test.ts` cover one-at-a-time calls, progress, the job and its endpoints.
- A browser check showed progress and the finished groups after reopening the dialog.

## References

- `openspec/changes/smart-category-cleanup/`
- [TDR-041: Normalise profile category spellings](041-normalise-profile-category-spellings.md)
- `src/services/user-profile/category-cleanup.ts`, `src/services/user-profile/category-cleanup-job.ts`
