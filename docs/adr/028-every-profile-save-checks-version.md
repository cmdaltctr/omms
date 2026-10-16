# ADR-028: Every profile save checks the version it read

- **Date:** 2026-10-16
- **Status:** Accepted
- **Deciders:** Aizat Hawari

## Context

The profile is one JSON document per user with a version number. Many writers load it, change it in memory and save the whole document: learning on three hosts, the backlog catch-up, decay, the AI cleanup, the category cleanup, the `memory` tool, web edits, profile merges and the normalise command. Some writers hold their copy for up to 40 minutes while the model works.

`updateProfile` could refuse a save when the version had changed, but only when the caller asked. Most callers did not ask. On 2026-10-13 a learning save replaced a category cleanup that had landed while it worked (TDR-050).

## Decision

1. Every profile save passes the version that the writer read. `updateProfile` requires it, so a new save point cannot leave it out.
2. A save whose version is out of date fails and changes nothing.
3. Learning reacts by loading the newer profile and merging its own model result again, up to three attempts. It never calls the analysis model twice for one batch.
4. Background steps skip the save and run again later. User actions ask the user to try again.

## Consequences

### Positive

- The last save can no longer silently remove another writer's work.
- The rule is checked by the compiler.

### Negative

- Long writers meet more conflicts and repeat their merge.

### Neutral

- Two writers still cannot both change the same document at once. One of them merges or tries again.

## Alternatives Considered

| Option                                  | Rejected Because                                                |
| --------------------------------------- | --------------------------------------------------------------- |
| Optional version, enforced by review    | It was optional before, and 12 of 14 save points skipped it     |
| A lock for the length of a learning run | Long runs block every other writer, and a crash leaves the lock |
| Per-item storage with item-level merges | Large storage change for a problem that version checks solve    |

## References

- [TDR-050: Profile saves lost to a stale learning copy](../tdr/050-profile-saves-lost-to-stale-learning-copy.md)
- `openspec/changes/guard-profile-saves/`
