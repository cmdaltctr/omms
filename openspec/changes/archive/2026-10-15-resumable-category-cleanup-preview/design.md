# Design

## Context

`previewCategoryCleanup` embeds each label, groups them, then `checkAndNameGroups` sends groups to the model 20 at a time, one call at a time. The group id is a hash of the sorted, normalised label keys (`groupId`), so the same label set always gets the same id. The preview job map lives in memory and is lost on restart. See proposal.md for the cost.

The claim that embedding and grouping are fast is an assumption from the log: no phase timing exists today. Task 1.1 adds the timing so the first live preview confirms or refutes it.

## Goals / Non-Goals

**Goals:**

- A rebuild only pays for groups that have no saved verdict.
- A crash, restart or timeout keeps the batches that finished.

**Non-Goals:**

- A control to force a full re-check. Verdicts expire after 30 days, and a changed model matters little for a rename the user reviews anyway. Add the control if it proves needed.
- Caching embeddings.
- Running model calls in parallel (TDR-044).
- Pausing profile learning.

## Decisions

1. **Cache key is the group id, per profile.** Table `profile_category_verdicts(profile_id, group_id, keep, name, created_at)` in `user-profiles.db`, next to `profile_category_cleanups`, created with the same `CREATE TABLE IF NOT EXISTS` pattern. `keep` is a JSON array of labels the model kept (empty when the model dropped the group). Alternative: key by the full prompt text. Rejected, because example descriptions change on every learning run and would invalidate nearly every entry.
2. **Reuse goes through the existing reply handling.** A saved verdict is fed to `applyReply` like a fresh model answer, so a kept label that no longer exists in the group is filtered out the same way, and a group left with fewer than two labels is dropped.
3. **Save only real answers.** `checkBatch` writes a verdict for each group the model answered, including a drop. The fallback (failed batch, missing reply, no model) writes nothing. A rebuild therefore retries only those groups.
4. **Save after each batch.** A crash on batch 9 keeps batches 1 to 8. One small insert per group, inside the loop that already awaits a model call, adds no measurable time.
5. **Prune on each preview.** After grouping, delete this profile's verdicts whose group id is not in the new groups, and any older than 30 days. Undo brings old labels back as old group ids. If a preview ran in between, those verdicts are gone and the model is asked again. Accepted: undo is rare.
6. **What is stored.** Category labels and the proposed name only. No example descriptions, prompts or raw replies, so the Security rules for the log and the capture trace do not apply. The log keeps counts: groups reused, groups sent, batches.
7. **Progress.** `onProgress` reports the batches that will run, not all batches. A rebuild with everything saved goes straight to done.

## Risks / Trade-offs

- [A saved name is stale after the user changed the profile model] → The user reviews every name. Entries expire after 30 days.
- [A saved verdict kept a label that learning has since re-categorised] → `applyReply` filters it, and the group can drop below two labels and disappear from the preview. A rebuild shows the rest.
- [The table grows] → Pruning on each preview keeps one row per current group.
- [Concurrent previews for one profile] → One job per user exists already. The CLI and the web app could overlap. Rows use `INSERT OR REPLACE` on the primary key, so the last write wins and both are valid answers.

## Migration Plan

The table is created on first use. No data to migrate. To roll back, drop the table. Nothing else reads it.
