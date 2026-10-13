# TDR-042: Prefer readable profile category labels

- **Date:** 2026-10-09
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Supersedes:** [TDR-041](041-normalise-profile-category-spellings.md), label selection priority only
- **Tags:** user-profile, categories, repair-preview

## Context

The first live preview proposed 544 renames affecting 587 items. It left the database unchanged. Five existing spaced labels would have become hyphenated: "git workflow", "Git workflow", "Decision style", "decision style" and "Process discipline". More frequent slug spellings won under TDR-041.

### Root Cause Analysis

The comparator ranked item count before readable spelling. Task 7.1 requires that a good label never becomes a slug or hyphenated form. The preview exposed the conflict, and the user chose to revise the rule before repair.

## Decision

Rank each key's existing spellings in this order:

1. Prefer labels without `_` or `-`.
2. Prefer the spelling used by more items across preferences and patterns.
3. Prefer a leading capital on a count tie.
4. Keep the first seen spelling when still tied.

When every spelling has separators, frequency still decides the winner. Tidy that winner with the existing rules. A lone "Anti-over-engineering" keeps its hyphens. Preserve capitals in acronyms and proper names. The hidden match key, workflow handling and item fields are unchanged.

The change is confined to the comparator in `profile-category.ts`. Saves, prompt lists and the repair command already share that function. A new live preview must pass before repair is confirmed.

## Consequences

### Positive

An existing readable label survives a more frequent slug. One rule still serves every host and save path.

### Negative

A rare readable spelling can displace a frequent separator spelling. The user accepted this trade-off. A hyphenated slug can remain when no plain spelling exists.

### Neutral

Category identity and item counts stay unchanged. The repair remains preview-first, with a separate approval for `--yes`.

## Alternatives Considered

| Option                             | Rejected because                                            |
| ---------------------------------- | ----------------------------------------------------------- |
| Accept the five hyphenated renames | Fails the preview's label safety check.                     |
| Remove all hyphens                 | Damages meaningful labels such as "Anti-over-engineering".  |
| Edit each item by hand             | Adds manual work and lets frequent variants undo the edits. |

## How to Recognise / Handle This Again

1. Take a SQLite backup of the profile database.
2. Run `om-memory-system profile-normalise-categories` without `--yes`.
3. Read every rename and check for newly introduced separators.
4. Confirm separately before applying any live repair.

## Revisit Triggers

Review the rule if a rare plain spelling damages a meaningful hyphenated label. Compare these measurements with the separately approved forced OpenCode import to decide whether the decision-model experiment is worth running. The repair has passed. The user approved the forced OpenCode import, then paused it after five completed batches. Its full measurement remains incomplete. The decision-model experiment has not been approved or started.

## Live measurements

The confirmed repair preserved 822 preferences, 838 patterns and 136 workflows. It renamed 582 items, added one changelog entry and retained the pre-repair snapshot. The second confirmed run reported zero changes and wrote nothing. The web API verified the repaired labels.

| Stage                        | Preferences: categories / items  | Patterns: categories / items     |
| ---------------------------- | -------------------------------- | -------------------------------- |
| Immediately before repair    | 816 / 822                        | 831 / 838                        |
| After repair                 | 727 / 822                        | 766 / 838                        |
| After forced OpenCode import | Paused; full measurement pending | Paused; full measurement pending |

Backup: `/Users/aizat/.omms/backups/user-profiles-before-normalise-apply-20261009-200320.db`. Evidence is recorded in `openspec/changes/normalise-profile-categories/live-category-preview.md`.

## References

- [Category rules](../using-memory.md#how-profile-categories-are-matched)
- [Repair command](../cli.md#normalise-profile-categories)
- `openspec/changes/normalise-profile-categories/live-category-preview.md`
- `tests/profile-category.test.ts`
