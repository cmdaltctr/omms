# Design

## Context

See proposal.md for why. Facts that shape the approach:

- Preferences and patterns carry a free-text `category`. `canonicaliseCategories` (from `normalise-profile-categories`) runs inside `createProfile` and `updateProfile`, so every save already applies the spelling rules and one label per key across both sections.
- `mergeItems` uses the category in its thresholds: same category strong 0.8 and weak 0.5, other category strong 0.9 and weak 0.8 (`CONFIG.userProfileEmbeddingThreshold*`). `detectConflicts` only compares items inside one category, and a confirmed conflict folds the less frequent item into the other.
- The existing AI cleanup (`ai-cleanup.ts`, `/api/user-profile/ai-cleanup`, `AiCleanupDialog`) already has a preview-then-apply flow and the profile model resolution for every host, including the external API for Claude Code.
- `updateProfile` writes one changelog entry per save; only `userProfileChangelogRetentionCount` (default 5) entries are kept. Live learning saves often, so a cleanup's snapshot soon drops out.
- The embedding service embeds one text per call and is local by default.
- Profile items have no stable id. They are arrays inside `profile_data`.

## Goals / Non-Goals

**Goals:**

- Reduce the number of categories on a real profile by grouping names by meaning, under the user's control.
- Never lose or alter a memory through the cleanup itself.
- An undo that still works after later learning runs.

**Non-Goals:**

- No automatic or scheduled cleanup.
- No change to the merge and conflict thresholds, and no new merging of items.
- No change to how new memories pick a category. Meaning-based reuse for new memories is a later change, measured after this one.
- Workflows (no category) are out of scope.

## Decisions

**Group by embeddings of the category names.** Each distinct label (after `canonicaliseCategories`) is embedded once with the configured embedder as a document. Labels are grouped by average-linkage clustering over cosine similarity, with a merge threshold of 0.80, kept as a named constant. Average linkage avoids chains where A is close to B and B to C but A is far from C. Alternatives: grouping by the mean of each category's item vectors (no embedding calls), rejected because item vectors describe the memory, not the label, so two unrelated memories under one vague label would pull their labels apart; asking the model to group all names in one call, rejected because about 1,800 names do not fit one prompt reliably and the result is not repeatable.

**The profile model checks and names each group.** Groups are sent in batches of 20. For each group the model sees the labels, their item counts and up to three example descriptions per label, and returns the labels to keep and one name. Labels the model removes leave the group; a group under two labels is dropped. The reply is parsed strictly: a label not in the group is ignored and a missing group falls back. Alternative: no model, most used label only. Kept as the fallback, because names like "Execution" alone are ambiguous and the examples let the model split them.

**Reuse the AI cleanup's model resolution, one call at a time with a longer limit.** The same host model or external API. Each call gets 180 seconds. Measured on the live profile (TDR-044): a reasoning model took about 110 seconds per call whatever the batch size, so the 60-second profile cleanup limit timed out every batch; five parallel calls timed out at 180 seconds and the provider then refused further calls, so calls run one at a time. A failed or timed-out batch falls back to the most used label for its groups and marks them as not checked. A failed cleanup never blocks profile learning or manual `memory` operations.

**The web preview is a background job.** One preview of 291 groups needs 15 calls, about 27 minutes with a reasoning model or about 9 minutes with its thinking switched off, and the Node web server ends requests after about 5.5 minutes. So `POST /api/user-profile/category-cleanup` starts a job held in the web app's memory, one per user, and returns its state; `GET` returns the state. The dialog polls every few seconds and shows progress. A restart of the web app drops the job; the user starts it again. Alternative: show groups at once and check them only from the command line. Rejected, because the check renamed 37 of 104 groups and removed stray names from 13 (TDR-044). Users with a reasoning model can switch its thinking off through `memoryExtraParams`; that setting affects every external API call, so it is documented, not set.

**Preview carries the profile version.** The preview returns the profile version it was built from and a list of groups with stable ids. Apply sends the accepted groups (their labels and names) and that version, so the server keeps no preview state. `updateProfile` gains an optional expected version; when it differs from the stored version, the save is refused. Alternative: compare versions in the service and then save. Rejected, because learning could save between the check and the write.

**Apply is a pure rename.** The new profile is the old one with only `category` changed on items in accepted groups. The name goes through `tidyCategory`, and `updateProfile` then applies `canonicaliseCategories` as for any save. The changelog summary starts with `Category cleanup:`.

**An undo record of its own.** A table `profile_category_cleanups` in the profile database stores each cleanup: id, profile id, time, and the list of renames. Each rename holds the section, a SHA-256 of the item's description, the old category and the new category. Undo takes the newest record that is not undone, matches current items by section, description hash and the new category, sets the old category back, saves through `updateProfile` with the summary `Category cleanup undone`, and marks the record undone. Hashes keep descriptions out of the extra table; the profile row already holds them. Alternative: restore from the changelog snapshot. Rejected, because only five entries are kept.

**One shared service, three thin surfaces.** `src/services/user-profile/category-cleanup.ts` holds preview, apply and undo. Grouping and the undo matching are pure functions in their own module (`category-groups.ts`) with `CONFIG` passed in, following the config stub rule. The web API, the web dialog and the CLI only call the service.

**The web review dialog follows `AiCleanupDialog`.** One row per group: the labels with counts, an editable name, an accept switch, and a "not checked by the model" mark. The header shows categories before and after. The button on the Profile page shows the current category count.

## Risks / Trade-offs

- [After a cleanup, more items share a category, so `mergeItems` folds near-duplicates at 0.8 instead of 0.9 and `detectConflicts` checks more pairs] → The preview states it. Conflict checks keep their three-call cap per run (TDR-043). Every later merge is saved through the changelog, and undo restores categories on items that still exist.
- [The 0.80 threshold groups only close wordings] → Measured on the live profile (TDR-044): 0.80 gives 291 groups and takes 1,724 categories to about 1,180, with groups of at most 13 names, in 6 seconds. Lower thresholds group more but build larger groups and take minutes. The model check removes stray labels; the user can reject any group. A later change can lower the threshold with evidence.
- [Embedding about 1,800 names takes time on a local embedder] → Names are embedded once per run, with progress shown; the preview is built on request, never on start-up.
- [The model sends profile text to a hosted service when the profile model is hosted] → The same data and the same model as the existing AI cleanup; no new destination. Names and descriptions are never logged.
- [Undo cannot restore an item whose description changed through a later merge] → Undo reports the count it could not find.

## Migration Plan

- The new table is created on first use with `CREATE TABLE IF NOT EXISTS`. Existing profiles are not changed until a user applies a cleanup.
- Rollback: undo the last cleanup in the app, or restore a changelog snapshot while it is kept. Reverting the code leaves stored categories as they are; the extra table is ignored.

## Open Questions

- Whether a Profile page hint should suggest a cleanup when categories exceed a share of items. Left out; the count beside the button is enough for a first release.
