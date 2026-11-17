# ADR-051: Automatic memory deletion is opt-in

- **Date:** 2026-11-16
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`friendly-settings`](../../openspec/changes/friendly-settings/proposal.md)

## Context

OMMS can delete unpinned memories and prompts that nobody updated for `autoCleanupRetentionDays`. Before this change, `autoCleanupEnabled` was the switch for that deletion.

Facts from the code that shape the decision:

- `CleanupService.runCleanup()` did two jobs in one run. It deleted old memories and prompts in every shard of the active space. It also did housekeeping: it pruned capture attempt records, the capture retry queue and cleanup undo records, then ran `VACUUM` on `user-prompts.db`.
- `shouldRunCleanup()` returned false when `autoCleanupEnabled` was off. Turning deletion off therefore also stopped the housekeeping, and the diagnostics tables grew without limit.
- The config template that `ensureConfigExists()` writes on first run set `"autoCleanupEnabled": true`. Most installs have that line, though the user never chose it.
- Only the OpenCode idle trigger called the cleanup. On Pi and Claude Code the `true` value deleted nothing. Adding triggers for those hosts while the old key stayed the switch would start deleting memories after an update.
- The manual **Cleanup** button on the memory list calls `runCleanup()` after its own confirm, whatever the switch says.
- A run skipped every old memory linked to an old prompt, then deleted that prompt. The memory went on the next run. Commit `b6a37ed5` (January 2026) added this to protect "memories referenced by recent prompts". The code collected links from the prompts it was about to delete, not from recent ones. A capture links a memory to the prompt of the same turn, so a memory linked to a recent prompt is recent too. No ADR, TDR or spec records a reason for a one-run delay.

## Decision

1. **A new key turns deletion on.** `autoDeleteOldMemories` is a global-only boolean with default `false`. Only this key lets an automatic run delete memories and prompts by age. A project config cannot set it. The template shows it commented out under a warning.
2. **The old key is retired.** Nothing reads `autoCleanupEnabled` to decide whether to delete. A file that sets it to `true` or `false` loads with no error and no config problem, and deletes nothing. `autoCleanupRetentionDays` keeps its meaning and validation.
3. **OMMS does not rewrite the user's file.** The old line stays where it is. The Memory cleanup card shows a note when the file still has `autoCleanupEnabled: true` and no new key.
4. **Housekeeping is separate from deletion.** `runDailyMaintenance(deleteOld)` runs the housekeeping on every call that the once-a-day guard lets through. It deletes memories and prompts only when `deleteOld` is true. Every automatic caller passes `CONFIG.autoDeleteOldMemories`. The housekeeping reads neither key. `shouldRunCleanup()` checks only the once-a-day guard and the running flag.
5. **One trigger per host, one guard.** OpenCode runs it when the session goes idle, Pi after a settled turn, and the web app on a daily timer (`startDailyMaintenanceTimer()`), which also covers Claude Code. The guard is the per-process `lastCleanupTime`.
6. **The count and the deletion share one selection.** `findOldMemories(cutoff)` selects the old unpinned memories, not memorisations, in every shard of the active space. `countCleanupCandidates(retentionDays)` counts that set and deletes nothing. The deletion removes that set. The Memory cleanup card shows this count in its confirm dialog before it saves `autoDeleteOldMemories: true`. The dialog says OMMS deletes them at its next daily check.
7. **A memory goes in the same run as its old prompt.** The deletion no longer skips a memory linked to an old prompt. A run deletes the old prompts and the old unpinned memories together, so the count equals the memories gone when that run ends. It deletes nothing that the earlier code would not have deleted on its next run.
8. **The manual Cleanup button is unchanged.** `runCleanup()` deletes by `autoCleanupRetentionDays` and runs the housekeeping, after the page's confirm. A user who presses it chooses deletion at that moment.

## Alternatives Considered

| Option                                            | Rejected Because                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Keep `autoCleanupEnabled` and change its default  | Old template files say `true`, so Pi and Claude Code users would start to lose memories after the update.              |
| Rewrite the old template line on load             | OMMS would edit a user's file on its own.                                                                              |
| Keep housekeeping behind the deletion switch      | With deletion off by default, the capture attempt records and the retry queue would grow without limit.                |
| A run record in the store shared by every process | The deletes are idempotent, and several OpenCode processes already run cleanup today. The per-process guard is enough. |
| A separate count query                            | Two queries can drift apart, and the confirm dialog would show a number the deletion does not match.                   |
| Keep the two-run delay and show both numbers      | The delay has no recorded reason, and "N now, M more tomorrow" is harder to read than one true number.                 |

## Consequences

### Positive

- No memory is deleted by age after an update unless the user turns deletion on after this change.
- An old config file never causes deletion on any host.
- Housekeeping runs on every host whether deletion is on or off.
- The user sees how many memories deletion would remove before turning it on.

### Negative

- OpenCode users who relied on automatic deletion lose it after the update. Nothing is lost: their memories are kept. The Memory cleanup card and `docs/upgrading.md` say how to turn deletion on again.
- A config file can hold a key that does nothing. The card note and the configuration guide explain it.

### Neutral

- Each process keeps its own once-a-day guard, so two hosts on one machine can each run the housekeeping on the same day.
- A rollback restores the old OpenCode behaviour for files that still set `autoCleanupEnabled`.

## References

- [Configuration](../configuration.md)
- [ADR-012: Keep cleaned failed turns for a limited time to retry capture](./012-capture-retry-queue-stores-cleaned-turns.md)
- [ADR-030: The profile cleans itself up on every host, with a restore record](./030-profile-cleanup-runs-on-every-host.md)
- `src/services/cleanup-service.ts`
- `tests/cleanup-maintenance.test.ts`, `tests/cleanup-count.test.ts`, `tests/cleanup-count-matches-deletion.test.ts`
