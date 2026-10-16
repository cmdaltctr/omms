# Design

## Context

See proposal.md, "Why". The evidence is in TDR-050.

`updateProfile(profileId, data, prompts, summary, expectedVersion?)` reads the stored version and refuses the save when `expectedVersion` is given and differs. Its `UPDATE ... WHERE version = ?` only catches a save that lands in the few milliseconds between that read and the write. A caller that passes no version therefore overwrites any save made since it loaded the profile.

Save points on `main` (14):

| Save point                                           | Passes version                            | Window between read and save              |
| ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `category-cleanup.ts` apply and undo                 | yes                                       | milliseconds                              |
| `claude-hook-api.ts` learning                        | no                                        | minutes (model call, merge, dedup calls)  |
| `profile-backlog.ts` catch-up                        | no                                        | minutes                                   |
| `pi/profile.ts` learning                             | no                                        | minutes                                   |
| `opencode/profile-learning.ts` learning              | no, but has a reload-and-merge retry loop | minutes                                   |
| `opencode/profile-learning.ts` automatic AI cleanup  | no                                        | minutes (model call)                      |
| `opencode/profile-learning.ts` learning paths        | no                                        | milliseconds (reads after the model call) |
| `memory-operations.ts` explicit preference           | no                                        | seconds (merge and dedup)                 |
| `api-handlers.ts` decay, AI cleanup apply, item edit | no                                        | milliseconds to seconds                   |
| `profile-admin.ts` profile merge                     | no                                        | seconds (merge and dedup)                 |
| `profile-normalise-categories-command.ts`            | no                                        | seconds                                   |

`analyzeProfile` (`src/core/profile-analysis.ts`) calls the model once for the raw result, then calls `mergeProfileData(existing, raw)`. The merge includes duplicate checks that may call the model. Those checks keep a per-process cache of checked pairs.

## Goals / Non-Goals

**Goals:**

- No save can replace a version that the writer did not read.
- A learning batch is not lost because of a conflict, and it does not pay for a second analysis call.
- Unchecked cleanup groups need an explicit tick.

**Non-Goals:**

- Field-level or item-level merging of two concurrent saves.
- Locking the profile while learning runs.
- Server-side refusal of unchecked groups. The apply request has no `checked` flag, and the user may still accept one on purpose.
- Restoring the 13 October cleanup on the live profile. That is an operator step after release.

## Decisions

### 1. `expectedVersion` becomes required

Change the signature to `updateProfile(profileId, data, prompts, summary, expectedVersion: number)`. The compiler then finds every save point, including any added later. A test fake that implements the method gets the same type. A JavaScript caller that omits the version gets `false` and no change, because `undefined` never equals the stored version.

Alternative: keep it optional and add a lint rule or a test that greps callers. Rejected: the type is stronger and needs no extra tooling.

### 2. A shared "merge and save" helper for learning

Add `saveMergedProfile(store, profile, analysis, promptsAnalyzed, summary)` in `src/services/user-profile/merge-and-save.ts`. `profile` is the profile as the writer read it, and `analysis` is the `{ raw, merged }` result of `analyzeProfile`. The first attempt saves `merged` with the version that was read. On a failed save it reloads the profile by id, runs `mergeProfileData(fresh, raw)` again, and saves with the fresh version. It stops after three attempts and returns `false`. It returns `false` at once when `merged` is null. It takes the store as an argument and does not import `src/config.ts`, so tests that stub config are not affected.

The same module has `saveProfile(profile, data, summary, promptsAnalyzed = 0, store?)` for a writer that read one profile and saves one change. It passes the version of `profile` and logs the code `version-changed` when the save fails. Without a `store` it loads the profile manager when it runs. Six call sites use it, and it keeps each call short: several files are over the size limit in `tests/file-size-ceiling.test.ts` and may not grow.

Claude Code learning, Pi learning, the backlog catch-up and the `memory` tool's profile add use it. Each caller already treats `false` as a failure, so the prompts stay unanalysed (Claude Code and the backlog throw "Profile update conflict"; Pi logs and returns).

OpenCode keeps its own loop, because each retry also applies decay and the validation step. It passes `existingProfile.version` to `updateProfile`, so the loop starts to work as written. Its retry count (three attempts in total) matches the helper. After the last conflict OpenCode used to mark the batch as analysed; it now keeps the prompts, as the other hosts do, and starts the profile backoff so that an idle event does not repeat the model call at once. The `memory` tool's profile add reports "The profile changed while saving. Try again." when all attempts fail; it returned success before, even when the save failed.

Alternative: retry the whole learning step, including the model call. Rejected: it doubles model cost and time for the common case.

Alternative: a lock row held for the whole learning run. Rejected: a run takes up to 40 minutes, and a crashed host would leave the lock behind.

### 3. Other writers pass the version they read

Decay, AI cleanup apply, item edit, OpenCode automatic cleanup and learning paths call `saveProfile`. Profile admin merge and the normalise command pass the version of the profile they read to `updateProfile`. Each already has a failure branch. The background ones (decay, automatic cleanup, learning paths) log the code from `saveProfile` and run again on their next trigger.

### 4. Dialog default

In `CategoryCleanupDialog.show()`, accept only groups with `checked: true`. The existing "not checked by the model" note stays. The "after" count already follows the accepted set.

## Risks / Trade-offs

- [More visible conflicts. Learning finishes about every 5 minutes, so a 30-minute writer may fail more often than before.] → The helper merges again instead of failing. Background steps run again later. The log codes show how often it happens.
- [A retry repeats the merge and its duplicate checks.] → The per-process dedup cache skips pairs already checked, and the merge has a model-call limit.
- [Three conflicts in a row could repeat for a busy profile.] → The batch stays unanalysed and is picked up by the next run, as with any other learning failure.
- [Tests and fakes that implement `updateProfile` need the new argument.] → The type change shows each one; update them in the same change.

## Migration Plan

No data migration. After release, the operator may re-run the category cleanup and accept only checked groups. Rollback is a normal revert; stored data is unchanged by this change.
