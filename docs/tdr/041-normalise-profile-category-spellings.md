# TDR-041: Normalise profile category spellings

- **Date:** 2026-10-09
- **Status:** Superseded by [TDR-042](042-prefer-readable-profile-category-labels.md)
- **Deciders:** Aizat Hawari
- **Tags:** user-profile, categories, matching

## Context

The recorded live sample held 754 categories for 760 preferences and 783 categories for 790 patterns. Ignoring case, underscores, hyphens and spacing joined 70 preference groups and 52 pattern groups. The label style audit recorded 1,573 labels, including 72 with acronyms and 5 with proper names. These are the earlier measurements supplied with the proposal; this change has not rerun the live measurement.

### Root Cause Analysis

The model could invent a spelling on each call. Exact string comparisons then treated spelling variants as different categories and applied the higher cross-category match threshold. Saves kept the raw spelling. The shared analysis prompt had no existing-category list, while OpenCode listed every raw spelling without a limit.

## Decision

- Keep a hidden key: trim, lower-case, replace `_` and `-` with spaces, collapse spaces. Compare category identity by this key.
- Choose one visible label at save time. Count items across preferences and patterns. The most used spelling wins; ties prefer no separators, a leading capital, then first seen.
- Tidy spacing and replace underscores in the winning label. Capitalise the first letter only when no capital exists. Preserve existing capitals and hyphens. Blank gives "General"; `explicit` stays `explicit`.
- Use the import-free `profile-category.ts` from `createProfile`, `updateProfile` and the repair command. Keep the existing creation filter for short workflows; updates leave workflows alone.
- Extract candidate ranking before the third change to `mergeItems`. Pass configuration into the helper. Keep merge actions and workflow safeguards unchanged.
- Share `buildCategoryList` in `src/core/extraction.ts` across hosts: one label per key, counts, most used first, 40 labels per type.
- Preview with `om-memory-system profile-normalise-categories`. Save only with `--yes`; `--dry-run` always previews. Save through `updateProfile` and keep a backup before live repair.

## Consequences

### Positive

Spelling variants share one visible label and the same-category match threshold. Acronyms such as "UI/UX" and proper names such as "OpenSpec" survive.

### Negative

Editing one item to another spelling of an existing key snaps back to the preferred label. The user accepted this cost. Rare labels can fall outside the prompt list. A frequently used hyphenated slug can still win.

### Neutral

Meaning-level matching stays unchanged. Workflows have no category. Existing labels change on their next save or confirmed repair.

## Alternatives Considered

| Option                           | Rejected because                                         |
| -------------------------------- | -------------------------------------------------------- |
| Force lower case                 | Damages 77 labels with acronyms or proper names.         |
| Force sentence case              | Changes "UI/UX" to "Ui/ux" and "OpenSpec" to "Openspec". |
| Repair automatically on start-up | Rewrites the user's profile without approval.            |
| Merge categories by meaning      | Requires the separate decision-model experiment.         |

## How to Recognise / Handle This Again

1. Compare distinct category labels against item counts for preferences and patterns separately.
2. Preview the category repair and inspect every rename.
3. Take a SQLite backup before confirming a live repair.
4. Run the confirmed repair twice. The second run must report `Changes: 0`.

## Revisit Triggers

After the approved live repair, run the approved forced OpenCode import and record distinct categories against item counts again. This measurement decides whether the experiment in `omms-feat-evaluate-memory-decision-models` is worth running. Live repair, the import and the experiment have not run in this change.

| Measurement                  | Preferences: categories / items | Patterns: categories / items |
| ---------------------------- | ------------------------------- | ---------------------------- |
| Earlier recorded sample      | 754 / 760                       | 783 / 790                    |
| Live profile, 2026-10-13     | 884 / 956                       | 953 / 1010                   |
| Spelling repair preview      | 868 / 956                       | 940 / 1010                   |
| After live repair            | Pending approval                | Pending approval             |
| After forced OpenCode import | Pending approval                | Pending approval             |

The 2026-10-13 preview changes 36 items and removes 16 preference and 13 pattern labels. Spelling explains little of the sprawl: most labels differ in wording, not spelling, for example "Execution" against "Direct execution". A meaning-based cleanup is the next step (operator decision 2026-10-13). The forced import measurement in task 7.5 is still pending.

## References

- [Profile categories](../using-memory.md#how-profile-categories-are-matched)
- [Repair command](../cli.md#normalise-profile-categories)
- [TDR-040: Workflow merging](040-workflows-collapse-into-one-entry.md)
- `src/services/user-profile/profile-category.ts`
- `openspec/changes/normalise-profile-categories/`
