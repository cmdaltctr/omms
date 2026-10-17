# ADR-030: The profile cleans itself up on every host, with a restore record

- **Date:** 2026-10-17
- **Status:** Accepted
- **Supersedes in part:** [ADR-029](029-ai-cleanup-runs-as-a-batched-job.md), decision 5
- **Deciders:** Aizat Hawari

## Context

Only OpenCode cleaned up the profile by itself. Every 100 analysed prompts it sent the whole profile to the model in one request and saved the answer with no review. A profile of about 2,000 items does not fit in one request on the external API, which stops after 60 seconds. AI Cleanup has no undo, and the profile keeps only its last 5 versions, which learning fills within hours. Pi and Claude Code had no automatic cleanup.

ADR-029 decision 5 planned to remove the OpenCode cleanup, so that every host cleans up only through the reviewed dialog. The maintainer chose the other way: all three hosts clean up by themselves.

An unreviewed run can do harm. In October 2026 a category cleanup wrote 284 groups that the review had left unticked. A cleanup that nobody reviews needs a way back.

## Decision

1. After a live learning pass on OpenCode, Pi or Claude Code saves, the host starts a shared cleanup in the background when the count of analysed prompts passes a multiple of `userProfileAutoCleanupInterval`. The default is 500, not the 100 that OpenCode used, because a run is paid for: about 24 model calls on a profile of 2,260 items. The setting `userProfileAutoCleanupEnabled` is on by default. A history import, a backfill or a catch-up run never starts it. A test checks which files may call it.
2. The run covers the whole profile in batches of at most 100 items, with the batch code of ADR-029. It saves every merge and removal that the model proposes into the newest profile. The save checks the version and tries again up to three times, as ADR-028 requires. A change is skipped when learning altered one of its items.
3. Before each save attempt, the run stores a restore record in `user-profiles.db`. The record holds the items it changes, as stored, and the merged item it writes. It does not hold a copy of the whole profile. The run deletes the record when the save fails. OMMS stops offering a record after 30 days and deletes it at the next daily cleanup, web app start, or access to the table. The run takes the record id from its own INSERT, because two hosts can write for one profile at the same moment.
4. **Undo last automatic cleanup** on the Profile page reverses the newest record that is not undone. It finds items by section, category key, description and steps. The category counts by its key, because every save keeps one spelling per category and may rewrite a stored item. Later learning stays.
5. A run that would remove, or merge into another item, more than 25% of the items it sent applies nothing and logs `too-many-changes`.
6. Each host gives the run the model it uses for profile learning. OpenCode uses its registered host model. Pi hands over its own model. Claude Code hands over the external model.
7. The old OpenCode path, which sent the whole profile in one request, is removed.
8. The Profile learning card of the Memory page holds the switch and the interval. They save through the safe global save of the other settings. The page accepts a whole number from 50 to 100000, because a lower value would run a paid cleanup after almost every learning pass. A hand edit of the file has no floor. A project config cannot override either key, so the page shows what the hosts use.

## Consequences

### Positive

- All three hosts keep the profile tidy, with the same code.
- A wrong merge or removal can be undone for 30 days without losing the other items that learning added or updated later.
- A run of any size finishes inside the time limit of each call.

### Negative

- The profile changes without a review. The restore record, the 25% limit and the skip rule reduce the risk. They do not remove it.
- A run on a profile of about 2,260 items makes about 24 model calls and takes about 6 minutes, every 500 prompts by default. A user who sets a short interval pays for more runs.
- A run that is still going when a host ends saves nothing.
- Undo cannot restore a change when the merged item was reworded, merged again or renamed after the run. It reports how many changes it did not find.
- Undo replaces a merged item with its originals. A counter update that learning made to the merged item after the run (for example a higher frequency) is lost. The match ignores counters, so Undo still finds the item.
- Pi and Claude Code users get the cleanup when they update. They can turn it off with `userProfileAutoCleanupEnabled`.

### Neutral

- The manual AI Cleanup window is unchanged. It still shows every change before it saves.
- The restore record format can serve an undo for the manual window later.

## Alternatives Considered

| Option                                     | Rejected Because                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Remove the OpenCode cleanup (ADR-029 plan) | The maintainer wants every host to clean up by itself                               |
| Automatic run with no restore record       | A wrong merge could not be undone, and the profile keeps only 5 versions            |
| Automatic run that waits for a review      | Not a cleanup that runs by itself; the manual window already does this              |
| Restore record holds a copy of the profile | Restoring a copy throws away what learning added after the run                      |
| Keep the OpenCode interval of 100          | Each run is about 24 paid calls; the maintainer chose 500 and a visible switch      |
| Run only in the web app                    | Pi and OpenCode run without the web app, and the web app has no host model          |
| Clean only the categories that changed     | Needs a change time for each item and a stored time of the last run; left for later |

## References

- [ADR-028: Every profile save checks the version it read](028-every-profile-save-checks-version.md)
- [ADR-029: AI Cleanup runs as a batched background job and applies edits](029-ai-cleanup-runs-as-a-batched-job.md)
- [TDR-051: AI Cleanup timed out on large selections](../tdr/051-ai-cleanup-timeout-on-large-selections.md)
- [TDR-052: Item matching broke when a save rewrote a category spelling](../tdr/052-item-matching-breaks-when-a-save-rewrites-a-category-spelling.md)
- `openspec/changes/archive/2026-10-17-auto-profile-cleanup-all-hosts/`
