# TDR-050: Profile saves lost to a stale learning copy

**Date:** 2026-10-16
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** profile-learning, categories, smart-category-cleanup, concurrency

## Context

On 2026-10-13 the category cleanup renamed 510 items and took the live profile from 1,738 to 1,292 categories (TDR-044). A scheduled recount on 2026-10-16 found 1,849 categories. 490 of the 510 renamed items had their old name again, and none had the new name. The cleanup's undo record was not marked as undone.

### Root Cause Analysis

The symptom was a reverted cleanup. The cause was a learning save that replaced the whole profile with a copy it had loaded before the cleanup.

Timeline from `~/.omms/omms-2026-10-13.log` (local time):

| Time           | Event                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| 09:48:35       | A Claude Code learning run merges 10 prompts into the profile it loaded (969 preferences)     |
| 09:53 to 10:29 | The same run checks for duplicates with the model                                             |
| 10:21:07       | `category cleanup: applied` with 232 groups and 510 renames                                   |
| 10:29:36       | `Claude Code profile learning finished`: the run saves its 09:48 copy                         |
| 10:31:06       | The next merge starts from 972 preferences and 1,021 patterns, the counts the 09:48 run saved |
| 10:32:00       | Logged items carry old names, for example "Git Housekeeping" and "Multi-Project Context"      |

The 10:29:36 save is the only write between the cleanup and the first old name. No later log line shows new names.

`updateProfile` checks the stored version only when the caller passes `expectedVersion`. Its `WHERE version = ?` clause only catches a save in the milliseconds between its own read and write. On `main`, 12 of the 14 save points pass no version, including Claude Code learning (`src/importer/claude-hook-api.ts`). TDR-047 says "two writers still cannot overwrite each other". That held only for callers that pass a version. OpenCode learning has a retry loop that reloads and merges again, but it never runs, because its save passes no version and so never fails.

A second finding came from the same check. On 2026-10-16 at 14:00 a cleanup applied 323 groups and 620 renames. Its 12:04 preview had 284 groups that the model did not check, after 15 failed batches. The review dialog accepts every group by default, so the apply included them.

## Decision

Change `guard-profile-saves`:

1. `updateProfile` requires `expectedVersion`. Every save point passes the version it read (ADR-028).
2. Learning on a failed save reloads the profile, merges the same model result again and saves with the new version. It makes at most three attempts and does not call the analysis model again. Claude Code, Pi, OpenCode and the backlog catch-up share this rule.
3. Background steps skip a failed save and log a code. User actions keep their "try again" error.
4. The cleanup dialog starts unchecked groups as unticked.

## Consequences

### Positive

- A cleanup, an edit or a merge can no longer be undone by a slow writer.
- A learning batch survives a conflict without a second analysis call.

### Negative

- Learning may repeat a merge and some duplicate checks after a conflict.

### Neutral

- The live profile still holds the reverted 13 October state plus the 16 October apply. Re-running the cleanup after release is an operator step.

## Alternatives Considered

| Option                                | Rejected Because                                                 |
| ------------------------------------- | ---------------------------------------------------------------- |
| Lock the profile during learning      | A run takes up to 40 minutes, and a crashed host leaves the lock |
| Retry learning from the model call    | Doubles model cost and time                                      |
| Refuse unchecked groups on the server | The user may still want one, after looking at it                 |

## How to Recognise / Handle This Again

1. A recount shows more categories than right after a cleanup, and the undo record has no `undone_at`.
2. Compare log lines after the apply: `"cat":` values that are old names mean a stale save. Find the first save after the apply and when that writer loaded the profile (its `profile merge start` line).
3. Check that the writer passes `expectedVersion` to `updateProfile`.

## Revisit Triggers

- Learning runs get much shorter or much longer.
- The profile moves to per-item storage, which would allow item-level merges.

## References

- `openspec/changes/archive/2026-10-16-guard-profile-saves/`
- [TDR-044](044-category-cleanup-threshold-and-model-pace.md), [TDR-047](047-category-cleanup-apply-after-learning.md), [ADR-028](../adr/028-every-profile-save-checks-version.md)
