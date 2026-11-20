# Proposal

## Why

Every AI Cleanup run sends the memories the user selects to the profile model. The model keeps most of them as they are. The next run selects them again, because the shortcuts do not know which memories the model already looked at. On a profile of about 3,000 memories, each run takes 10 to 20 minutes and mostly re-checks memories that were fine. The dialog also opens with Low Freq already ticked, so the user must undo a choice that they did not make.

## What Changes

- After a cleanup, OMMS remembers each memory that the model looked at and did not merge or remove. These memories are "checked".
- A memory stops being checked when its text (description or steps) or its category changes, or when a ticked merge rewrites it. A change of frequency alone does not clear the mark.
- A batch that fails, times out or returns no valid answer marks nothing. Stop marks nothing.
- When the user applies a review, the memories of the changes that the user did not tick are marked too, because the model looked at them and the user decided to keep them.
- The AI Cleanup dialog opens with nothing ticked. The user chooses a shortcut.
- **Low Freq (≤3)** and **Same Category (3+)** pick only memories that are not checked. Same Category counts every memory of a category, checked or not, toward its 3+ size, but ticks only the unchecked ones.
- A new **Clean All** button picks Low Freq and Same Category together, unchecked memories only.
- **Select All** picks every memory, also the checked ones, for a full recheck. **Deselect All** stays.
- A status line says how many checked memories a shortcut skipped.
- Each shortcut button shows a tooltip on hover and on keyboard focus that says what it picks.
- Rows of checked memories carry a "Checked" label with a tooltip that says what it means.
- The dialog file is split, because it is at its 500-line ceiling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `profile-ai-cleanup`: adds requirements for remembering checked memories, for what marks a memory and what clears the mark, for the selection shortcuts, and for the opening state of the dialog. No existing requirement changes its text, so the delta uses ADDED only.

## Decisions confirmed by the user

1. **Clean All** picks Low Freq (≤3) and Same Category (3+) combined, among unchecked memories only. **Select All** picks every memory, including the checked ones: it is the full-recheck path. **Low Freq** and **Same Category** pick unchecked memories only. **Deselect All** stays.
2. The checked mark lives in a side table in the profile database, not on the profile items. See `design.md`, decision 1.
3. Only a change to the text (description or steps) or the category of a memory clears its mark. Frequency is not part of the fingerprint, so a new observation keeps the mark.
4. The model's keep verdicts are saved when the cleanup job finishes, before the review. Back keeps them and drops the proposed changes.
5. **Same Category (3+)** counts every memory of a category, checked or not, toward the threshold, and ticks only the unchecked ones.
6. Rows of checked memories keep the "Checked" label.
7. Each shortcut button and the "Checked" label show a tooltip with a plain description.

## Impact

- Server: a new store `src/services/storage/profiles/ai-checked.ts` (one table in `user-profiles.db`), a key and verdict module `src/services/user-profile/ai-cleanup-checked.ts`, changes to `ai-cleanup-batches.ts`, `ai-cleanup-job.ts`, `ai-cleanup-apply.ts`'s caller in `src/services/ai-cleanup-handlers.ts`, and one new route `GET /api/user-profile/ai-cleanup/checked` in `src/services/profile-cleanup-routes.ts`.
- Web: `AiCleanupDialog.tsx` (split into select and review parts), `CleanupSelectShortcuts.tsx`, `cleanup-selection.ts`, `web/src/lib/api.ts`, `useAiCleanupJob.ts` or a new hook for the marks, translations in `en`, `zh` and `ar`.
- Docs: the AI Cleanup section of `docs/web-ui.md`, a new ADR.
- Hosts: the web app is the only place the dialog runs, so Pi and OpenCode have the same capability. The automatic cleanup (ADR-030) shares the batch runner and ignores the marks in this change.
- No change to the profile item shape, the profile version or the changelog.
