# Design

## Context

`applyCategoryCleanup` compares `profile.version` with the version the preview recorded, then calls `updateProfile(..., input.version)`, which saves only when the stored version still equals that argument. The rename is a map from label to new name, so it does not depend on the profile staying frozen. See proposal.md for the failure.

## Goals / Non-Goals

**Goals:**

- Apply succeeds after learning saved a version between preview and apply.
- Keep the guard against two writers saving at once.

**Non-Goals:**

- Pausing profile learning during a preview.
- Making the preview faster (see `resumable-category-cleanup-preview`).
- Changing undo. It already works on a newer profile.

## Decisions

1. **Compare-and-set on the version read inside apply.** Apply reads the profile, builds the renames, and passes `profile.version` to `updateProfile`. A save by learning between that read and the write returns `false`, and Apply reports a retryable error. The window is milliseconds. Alternative: drop the guard. Rejected, because a concurrent save would be overwritten.
2. **Remove `version` from the apply input and the preview.** A value that nothing checks invites a later reader to trust it. Alternative: keep it and ignore it. Rejected as a phantom field. The web app and server ship together, so no client sends an old shape. An unknown extra `version` field in a request body is ignored.
3. **Items that learning added or changed after the preview.** A new item whose label is in an accepted group is renamed too, which is what the user asked for by accepting the group. An item learning moved to another label is left alone. A group whose labels all vanished renames 0 items and returns `renamed: 0`.
4. **The preview counts are a snapshot.** The dialog already shows counts before and after. After apply, the toast reports the real number renamed. No change.

## Risks / Trade-offs

- [A renamed label set differs from what the user saw] → Only accepted labels move, and undo records exactly what was renamed.
- [Apply fails on the write race] → The message says to try again. The next try reads the newer version.
