# Design

## Context

Observed in the code:

- Profile item ids in the dialog and in the job are array positions (`pref_0`, `pat_3`, `wf_1`) of the profile sorted by `sortProfileItems`. Learning, merges and category cleanup add, remove and reorder items, so a position names a different memory after a save. Apply finds items by `profileItemIdentityKey` (category key, description, steps) for this reason.
- Many writers rebuild items. `mergeConfirmedMatch` and the merge code spread the existing item. `rebuildProfileUsing` builds the merged item from the model output plus a fixed list of kept keys. Category cleanup spreads the item with a new category. Any new field on an item survives only where a writer spreads it, and an AI merge copies it from the original when the model returns no item.
- Every profile save writes a new version and a changelog snapshot of the whole profile (`updateProfile`). The dialog compares `profile.version` with the server's version before it starts a job.
- The model sees `id`, `category`, `description` and `frequency` of each memory (`formatForAI`). It does not see steps.
- `runInBatches` already knows which batches succeeded and which failed. `cleanupBatch` turns the reply into a diff. `normalizeAIMapping` turns a missing or malformed mapping into an empty one (a no-op), which cannot be told from a real "keep everything" reply today.
- Side tables in `user-profiles.db` already exist (`profile_auto_cleanups`, `profile_category_cleanups`). They open a connection per call from `getStoragePath()`, so a memory space switch needs no reset handle. SQL outside `src/services/storage/` is blocked by the ratchet in `tests/modularity-ratchets.test.ts`.
- `AiCleanupDialog.tsx` is 513 lines and is listed in `tests/file-size-ceiling.test.ts` at 513. It must shrink under 500 and lose its entry.
- The dialog sets Low Freq on open (`initSelect`). The shortcuts live in `CleanupSelectShortcuts.tsx` and `cleanup-selection.ts`.

See `proposal.md` for the reason and the decisions the user confirmed.

## Goals / Non-Goals

**Goals:**

- Skip memories that the model already looked at and nobody has changed since.
- Never mark a memory that the model did not see.
- Leave the profile items, the profile version and the changelog untouched by marking.
- Keep the pure selection rules in one tested function file.

**Non-Goals:**

- The automatic cleanup (ADR-030) does not read or write marks.
- No mark for memory capture, memory dedupe or category cleanup.
- No setting, no expiry of marks, no "uncheck this memory" button. Select All covers a full recheck.
- No change to the batch size, the batching rule, Apply's matching rule or Undo.

## Decisions

### 1. Where the mark lives: a side table keyed by a content hash

A new table `profile_ai_checked (profile_id TEXT, item_key TEXT, checked_at INTEGER, PRIMARY KEY (profile_id, item_key))` in `user-profiles.db`. `item_key` is the SHA-256 of the section and `profileItemIdentityKey` of one memory: the category key (`categoryKey`), the description and the steps. Apply already uses this identity. The store file is `src/services/storage/profiles/ai-checked.ts`, built like `auto-cleanups.ts`.

Why a hash of content and not a position: positions move on every save. The hash needs no id, so reorders cost nothing, and a memory that changes gets a new hash and is unchecked with no extra code. A hash also holds no memory text, so the table adds no new copy of profile text.

Why a side table and not a field on the item (for example `aiCheckedAt` or `aiCheckedHash`):

| Option                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field on the item            | Each marking run is a profile save: a new version, a full-profile changelog snapshot, and a conflict with learning that saves several times an hour. The dialog's version check then fails after every run until the page reloads. A writer that rebuilds items (an AI merge without a model item, category cleanup) copies or drops the field by accident. The profile JSON also leaves the shape that Pi, OpenCode and the export read. |
| Side table (chosen)          | No version change, no changelog entry, no conflict. A rebuilt or edited item simply has a different hash. The table follows the memory space because it sits in the space's `user-profiles.db`.                                                                                                                                                                                                                                           |
| Side table keyed by `pref_N` | Positions are not stable. Rejected.                                                                                                                                                                                                                                                                                                                                                                                                       |

Cost: an orphan row stays when a memory changes or goes away. Each marking run deletes the rows of the profile that match no current memory (see the risks).

Frequency is not part of the hash (decision 3 in the proposal). A new observation raises the frequency of a memory without changing what the model judges, so the mark stays. Steps are part of the hash because Apply already treats them as identity, although the model does not see them. A ticked merge can rewrite the keeper with the same text, so Apply deletes the keeper's key on its own (decision 2).

The profile model's `item_key` function lives with the verdict code, `src/services/user-profile/ai-cleanup-checked.ts`, and reuses `categoryKey`. It takes a section and an item and returns the hex hash. It is pure and has no `CONFIG` import.

### 2. What "kept" means, and when marks are written

Two writes, each small.

1. **When the job finishes (state `done`).** `runInBatches` adds to its result the list of item ids of each successful batch that the reply neither merges nor removes. The job turns the ids into keys, using `old` (the profile the model saw), and writes them with one call to the store. A failed batch contributes nothing. A reply with no valid mapping counts as failed for marking: `normalizeAIMapping` keeps its tolerant output for the diff, and `callAICleanup` also returns `mappingValid`, which `cleanupBatch` uses to return an empty kept list. When every batch fails, or Stop ends the job, nothing is written. The job writes before it sets `done`, so a reader never sees a done job without its marks. A failed store write is logged as a code and does not fail the job.
2. **At Apply.** The handler turns the proposed changes into keys from `job.old`: every item id in a merge group or a removal. It subtracts the items of ticked changes and writes the rest. It deletes the key of each ticked merge keeper, so a merge that leaves the keeper's text unchanged cannot leave it checked. It runs after a saved profile, with the same user, and a failure is logged and does not fail Apply.

Why not mark everything at Apply only: a closed tab, the 30 minute expiry or a restart would waste a 10 to 20 minute run, and the next run would repeat it. The model's verdict on a kept memory does not depend on the review.

Why not mark everything at job end: a memory in a proposed merge or removal has a pending proposal. If the user presses Back, the proposal is lost. Marking it would hide the memory from the next shortcut with no review of the proposal. So these memories are marked only when the user decides at Apply.

An unticked change is marked: the model looked at the memory, proposed a change, and the user chose to keep it.

Back keeps the marks written at job end and drops the proposals. This differs from the docs line "Nothing is saved before Apply", which the docs change rewrites to say that the profile is unchanged before Apply and that kept memories are remembered.

### 3. The dialog reads marks as ids for its own profile version

`GET /api/user-profile/ai-cleanup/checked` loads the active profile, sorts it as `sortedProfile` does, hashes each item, and returns `{ profileVersion, ids }`, where `ids` are the positions (`pref_3`) of the checked items. The dialog compares `profileVersion` with `profile.version`. A mismatch or a failed read gives an empty set. The server holds the hash, so the browser needs no crypto, and the dialog keeps its position ids. A new hook `useAiCheckedIds(open, version)` reads on open and again after Back, and keeps the file small.

The route sits next to the other cleanup routes in `profile-cleanup-routes.ts` and the handler in `ai-cleanup-handlers.ts`. Both files stay under 500 lines.

### 4. Selection rules as pure functions

`web/src/lib/cleanup-selection.ts` gets one function for each rule. Each returns `{ ids, skipped }`, where `skipped` is the number of checked memories that match the rule and were left out:

- `lowFrequencyIds(items, checked, limit = 3)`: unchecked memories with a frequency of 3 or less.
- `sameCategoryIds(items, checked, minimum = 3)`: counts every memory of a category, checked or not, toward `minimum` (decision 5 in the proposal), and picks only the unchecked ones. A category whose memories are mostly checked can still give a new memory a partner to merge with in the same batch, because the batch holds only the selection; this is accepted, and Select All covers it.
- `cleanAllIds(items, checked)` for Clean All: the union of the two rules above. `skipped` counts the checked memories that either rule matches, each once.
- `allIds(items)` for Select All: every memory, checked or not, with `skipped` 0.

`sameCategoryIds` keeps its exact-name rule and its skip of empty categories. Its current callers pass no `checked` set, so the default is an empty set.

`CleanupSelectShortcuts` gets the Clean All button and an `onSelectClean` prop, and shows the skipped count in the status line it already has (`role="status"`), under the hint of the last shortcut. The five buttons are Clean All, Low Freq, Same Category, Select All and Deselect All.

Each button sits in the existing `Tooltip` (`web/src/lib/components/ui/tooltip.tsx`). The tooltip shows on hover and on keyboard focus, and links to the button through `aria-describedby`. The texts:

| Button             | Tooltip                                                          |
| ------------------ | ---------------------------------------------------------------- |
| Clean All          | Low Freq plus Same Category, unchecked memories only             |
| Low Freq (≤3)      | Memories seen 3 times or fewer, unchecked memories only          |
| Same Category (3+) | Memories in categories of 3 or more, unchecked memories only     |
| Select All         | Every memory, including ones already checked, for a full recheck |
| Deselect All       | Untick everything                                                |

The "Checked" label of a row sits in the same `Tooltip`: "The AI already checked this memory and kept it. It is skipped unless its text or category changes." The tooltip uses logical classes, so it works in Arabic.

### 5. The dialog opens empty and the file is split

`initSelect` stops calling `pick` with Low Freq. It sets an empty selection.

To get under 500 lines, `AiCleanupDialog.tsx` keeps state, the job, Apply and the footer. Two new files take the markup:

- `AiCleanupSelect.tsx`: shortcut row, the list of groups and rows, the "Checked" label, the count and Analyze Selected.
- `AiCleanupReview.tsx`: the merge, removal and kept sections.

The dialog entry is removed from `tests/file-size-ceiling.test.ts` when the file is at or under 500 lines. The new files must stay under 500 lines.

### 6. Hosts

The dialog is a web feature, shown for the profile of every host, so Pi and OpenCode need no separate work. The automatic cleanup shares `runInBatches`. Its callers ignore the new field in the result.

## Risks / Trade-offs

- [A memory keeps its mark after many new observations] → Accepted (decision 3). Frequency does not change what the model judges. Select All rechecks everything.
- [An orphan row stays when a memory changes] → Each marking run deletes the rows of the profile that match no memory in a fresh read of the profile. The table holds one short row per memory at most.
- [A reply with no mapping marks a whole batch by mistake] → `mappingValid` blocks it, and a test breaks if the check is removed.
- [A memory that the model could not merge because its partner is in another batch is marked] → Accepted. The model merges inside a batch only (ADR-029), so this is the same limit the docs state. Select All covers it.
- [Marks and `old` can disagree when learning changed an item during the run] → The key is built from `old`, which the model saw. The changed item has another key now, so it shows as unchecked, which is correct.
- [A switch to another space during a run writes marks into the wrong space] → Handled. The check found the gap: the job wrote its marks into the new space. The job map now registers with `resettable()`, so a space switch stops and drops every job, as a restart does. The run writes no marks, and Apply finds no result, so it cannot edit the new space's profile or marks. A write to the stored path of the old space was not chosen: it would open a handle on a space that is no longer active, could recreate a file in a deleted space, and the prune would read the new space's profile. Task 2.8 tests it.
- [`profile_ai_checked` is not in a space backup] → The backup copies the whole space folder, so the table travels with `user-profiles.db`. A transfer that copies profile items to another space does not copy marks, so the target starts unchecked. This is safe.

## Migration Plan

`CREATE TABLE IF NOT EXISTS` runs on the first use, as in `auto-cleanups.ts`. An older version of OMMS ignores the table. A downgrade needs no step. Existing profiles start with no memory checked, so the first run after the upgrade behaves as today, and the marks build up from there.

## Open Questions

None. The user confirmed the decisions in `proposal.md`.
