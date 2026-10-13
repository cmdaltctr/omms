# Proposal

## Why

The model writes the same category in different ways: "Communication style", "communication_style", "communication-style", "Communication Style". The profile treats each spelling as a separate category. In the live profile, 760 preferences have 754 distinct categories, and 790 patterns have 783. Ignoring case, `_`, `-` and spaces, 70 preference groups and 52 pattern groups are split. The Settings page shows each spelling as its own coloured pill.

Three causes:

1. The shared prompt behind Pi and Claude Code history imports never shows the model the existing categories. OpenCode's prompt does. The model invents a name each time.
2. The merge code compares categories as exact strings, so the lower same-category similarity threshold (0.8, against 0.9 across categories) rarely applies and near-duplicates survive.
3. Nothing cleans a label before it is stored. `_` slugs such as "writing_standards" reach the Settings page.

A forced lower case would damage real labels. The live categories hold 72 acronyms ("UI/UX", "CI cost minimization") and 5 proper names ("OpenSpec conventions"), and 798 labels use sentence case.

## What Changes

- Every category has a hidden match key: trimmed, lower case, with `_`, `-` and runs of spaces turned into a single space. The key decides whether two labels are the same category. It is never shown.
- Every category has one visible label. When a profile is saved, an existing spelling without `_` or `-` takes priority over separator spellings. Among equally readable spellings, the most used wins across preferences and patterns. If every spelling has separators, the most used wins. Ties prefer a leading capital, then the first seen.
- A label is tidied before it is stored: `_` becomes a space, spaces collapse, and an all-lower-case label gets a capital first letter. A label that already holds a capital ("UI/UX", "OpenSpec", "Communication Style") is left as written. A blank label becomes "General". The special value `explicit` stays `explicit`.
- The merge compares categories by key, so a stored item with an old spelling still matches.
- The shared profile prompt lists the existing categories, as OpenCode's prompt already does. The list shows the visible labels, with item counts, most used first, at most 40 per type. OpenCode's prompt uses the same builder.
- A new terminal command, `om-memory-system profile-normalise-categories`, applies the same rule to the stored profile. It lists every rename first and changes nothing without `--yes`.
- Only the label changes. No item is merged, removed or reordered.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-learning`: adds the rules for how category labels are matched, stored, listed in prompts, and repaired.

## Impact

- `src/services/user-profile/profile-category.ts` (new): the pure key, tidy, and profile-wide canonical functions.
- `src/core/extraction.ts`, `src/core/profile-analysis.ts` and `src/adapters/opencode/profile-learning.ts`: the shared category list in the prompts.
- `src/services/user-profile/user-profile-manager.ts`: category comparisons in `mergeItems`, and the save path in `createProfile` and `updateProfile`.
- `src/cli/index.ts` and a new `src/cli/profile-normalise-categories-command.ts`: the repair command.
- Tests for the pure functions, the merge, the save path, the prompt list, and the command.
- `docs/using-memory.md`, `docs/cli.md`, and a new TDR.
- Hosts: the profile code is shared, so Pi, OpenCode, and Claude Code behave the same. The web UI needs no change: the pill colour already ignores case, so one key keeps one colour.
- Existing stored profiles keep their old spellings until the next save or the repair command (see `tasks.md`, group 7).
- Meaning-level merging ("Communication" against "Communication style") is out of scope. The experiment `evaluate-memory-decision-models` (worktree `omms-feat-evaluate-memory-decision-models`) decides whether embeddings or a decision model such as Jev should do it. Its `L0-normalise` arm is the key rule in this change. A passing result leads to a later proposal.
- Both this change and `fix-workflow-merging` edit `user-profile-manager.ts`. They ship in one pull request on this branch.
