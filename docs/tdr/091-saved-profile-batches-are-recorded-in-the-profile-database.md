# TDR-091: Saved profile batches are recorded in the profile database

**Date:** 2026-11-20
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** profile-learning, storage, idempotency

## Context

Profile learning takes a batch of prompts from `user-prompts.db` and claims them for 10 minutes. It calls the model, saves the merged profile to `user-profiles.db`, and then marks the prompts learned in `user-prompts.db`. The two files are separate databases, so the save and the mark cannot share one transaction.

PR #297 retried a failed mark 3 times and then kept the prompt ids in memory for the next pass in the same process. A restart, or a pass in another host process, lost that list.

### Root Cause Analysis

When the save landed and every mark failed, nothing durable said that the batch was already in the profile. After the claim ran out, the next pass took the same prompts, called the model again and saved them a second time. Counts and evidence doubled.

## Decision

The profile save also writes the batch's prompt ids to a new table in `user-profiles.db`:

```sql
CREATE TABLE IF NOT EXISTS learned_prompts (
  profile_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, prompt_id),
  FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
)
```

- `updateProfile` runs the versioned `UPDATE` and the inserts in one transaction. A version conflict or an error writes no row.
- `createProfile` writes the profile row and the inserts in one batch.
- Before the model call, the live pass and the catch-up run look up the batch in the table. A recorded prompt is marked learned and dropped from the batch.
- A successful mark deletes the rows of its prompts. A row lives only from the save until the mark.
- A forced history re-analysis deletes the rows of each prompt it puts back in the queue, for every profile, before the reset. The rows are keyed by profile, but the reset runs before the import knows which profile the drain will use. A row only stops a model call, and a forced run asks for that call.
- The in-memory list of PR #297 is removed. The table does the same job and also survives a restart.

The code is in `src/services/storage/profiles/learned-prompts.ts` and `src/core/profile-learning/learned-record.ts`.

## Consequences

### Positive

- A saved batch is never learned twice, after a restart, or in another process, on every host.
- The record exists exactly when the save landed, because both are in one write.
- The table stays near empty: rows exist only while a mark is failing.

### Negative

- Every learning save now runs as a transaction.
- If the mark succeeds and the row delete fails, a row stays. It names a prompt that is already learned, so it does no harm. A forced history re-analysis deletes it before the reset, so that prompt still goes to the model.

### Neutral

- The table lives in each memory space's `user-profiles.db`, so a space switch follows it with no extra reset.

## Alternatives Considered

| Option                                    | Rejected Because                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Record the ids in `user-prompts.db`       | That is the database whose write failed. The record must land with the profile save.     |
| Keep the in-memory list only (PR #297)    | Lost on restart and not shared between host processes.                                   |
| A new `.db` file for the record           | Cannot share a transaction with the profile save, and adds a file to every memory space. |
| Keep rows for 30 days instead of deleting | Blocks a forced history re-analysis of recently learned prompts.                         |

## How to Recognise / Handle This Again

1. Symptom: profile counts or evidence jump by a batch, and the log shows `profile learning: prompts not marked as learned`.
2. Check `SELECT COUNT(*) FROM learned_prompts` in `user-profiles.db`. Rows mean marks are failing.
3. Fix the cause of the failing mark in `user-prompts.db`. The next pass marks the recorded prompts without a model call.

## Revisit Triggers

- The prompt store and the profile store move into one database.
- A new writer saves a learning batch without passing the prompt ids.

## References

- PR #297 (retry of the mark and the in-memory list)
- `openspec/specs/profile-learning/spec.md`, requirement "A saved batch is never learned twice"
- `tests/profile-learned-ledger.test.ts`
