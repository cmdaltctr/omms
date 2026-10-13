# Proposal

## Why

Profile learning names a category for each new preference and pattern, and most names are new. On the live profile (2026-10-13) 956 preferences sit in 884 categories and 1,010 patterns in 953. The spelling repair in `normalise-profile-categories` only brings that to 868 and 940 (TDR-041): most names differ in wording, not spelling, for example "Execution" and "Direct execution". Categories cannot group memories, and the category list in the profile prompt cannot steer reuse while it is this noisy.

Fixed label lists were tested in Experiments 01 to 23 and rejected for the product: each user's labels must grow from their own memories. A user-triggered cleanup that groups category names by meaning gives the user control and keeps labels their own.

## What Changes

- A **category cleanup** finds category names that mean the same thing and proposes one name per group.
  - Grouping uses embeddings of the category names from the configured embedder, across preferences and patterns. Experiment 23 found that about 3 in 10 observations fit a label from the other section.
  - The profile model then checks each group: it moves out names that do not belong and chooses the group's name. Without a model, the most used name in the group is chosen and the group is marked as unchecked.
- The user sees a **preview** of every group (the names, item counts and proposed name), can reject a group or edit its name, and applies the rest.
- Applying is **rename only**. Descriptions, evidence, counts and confidence stay unchanged, and no item is removed or merged by the cleanup. The change is saved through the profile changelog.
- The user can **undo the last cleanup**. Undo restores the old category on every item that the cleanup renamed and that still exists, and reports any item that later learning merged away.
- The web app Profile page gains a **Clean up categories** button with the current category count, and the CLI gains `om-memory-system profile-cleanup-categories` (preview by default, `--yes` to apply, `--undo`). Both use one shared service, so every host behaves the same.
- The preview states that after a cleanup more memories share a category, so later learning merges near-duplicates more readily (same-category threshold 0.8 instead of 0.9).

## Capabilities

### New Capabilities

- `profile-category-cleanup`: grouping profile category names by meaning, previewing and applying a rename-only cleanup, and undoing the last cleanup.

### Modified Capabilities

None. The category label rules and the category list in the profile prompt stay as `normalise-profile-categories` defines them; a cleaner category set makes that list more useful without changing its rules.

## Impact

- Shared services (`src/services/user-profile/`): a category cleanup service (grouping, model check, apply, undo). It reuses `canonicaliseCategories`, the embedding service, the profile model resolution of the existing AI cleanup, and `updateProfile` with its changelog.
- Web API: preview, apply and undo endpoints beside `/api/user-profile/ai-cleanup`.
- Web UI: a button and a review dialog on the Profile page, in English, Chinese and Arabic.
- CLI: one new command; `docs/cli.md`, `docs/using-memory.md` and `docs/web-ui.md` updated.
- Model use: one embedding per distinct category name per run, and one profile model call per 20 groups. The model receives category names and up to three example descriptions per name, the same profile data the existing AI cleanup already sends to the same model.
- Storage: one small table in the profile database records each cleanup's renames, so undo works after the profile changelog (5 entries kept) has moved on. No new dependencies.
- Depends on `normalise-profile-categories` (merged into `integration`).
