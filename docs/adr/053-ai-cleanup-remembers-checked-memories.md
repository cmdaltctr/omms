# ADR-053: AI Cleanup remembers checked memories in a side table

- **Date:** 2026-11-20
- **Status:** Proposed
- **Deciders:** OMMS maintainer
- **Change:** [`ai-cleanup-remember-checked`](../../openspec/changes/archive/2026-11-20-ai-cleanup-remember-checked/proposal.md)

## Context

Each AI Cleanup run sends the selected memories to the profile model. The model keeps most of them as they are. Before this change the next run sent the same memories again, because the dialog did not know which memories the model had already looked at. On a profile of about 3,000 memories, one run took 10 to 20 minutes.

The dialog names memories by their position in the sorted profile (`pref_3`). Learning, merges and category cleanup add, remove and reorder memories, so a position names another memory after a save. Every profile save also writes a new version and a changelog snapshot of the whole profile.

## Decision

1. **A side table.** `profile_ai_checked (profile_id, item_key, checked_at)` lives in `user-profiles.db` of the active memory space. The store is `src/services/storage/profiles/ai-checked.ts`. Each call opens the database from the live storage path, so a space switch shows the marks of the new space.
2. **A content hash as the key.** `item_key` is the SHA-256 of the section and `profileItemIdentityKey`: the category key, the description and the steps. This is the identity that Apply already uses. A reorder keeps the key. An edit of the text or the category gives a new key, so the mark ends with no extra code. The table holds no memory text.
3. **Frequency is not in the key.** A new observation raises the frequency but does not change what the model judges, so the mark stays. A ticked merge can write the keeper back with the same text, so Apply deletes the keeper's mark on its own.
4. **When marks are written.** When a job finishes, before its status reads done, OMMS marks the memories that a successful batch neither merged nor removed. A failed batch, a reply with no valid mapping, and Stop mark nothing. At Apply, OMMS marks the memories of the changes that the user did not tick. Each marking run deletes the marks of the profile that match no memory now. A failed write is logged as a code and does not fail the job or Apply.
5. **The dialog reads ids, not hashes.** `GET /api/user-profile/ai-cleanup/checked` returns the position ids of checked memories and the profile version they belong to. The dialog ignores ids of another version.

## Alternatives Considered

| Option                                    | Rejected Because                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A field on each profile item              | Each marking run would save the profile: a new version, a changelog snapshot and a version conflict with learning. Writers that rebuild items would copy or drop the field by accident. |
| A side table keyed by position (`pref_N`) | Positions change on every save.                                                                                                                                                         |
| Frequency in the key                      | Learning raises frequencies all the time, so most marks would end within a day. The user chose to keep the mark until the text or category changes.                                     |
| Mark everything only at Apply             | A closed tab, the 30-minute expiry or a restart would waste a 10 to 20 minute run.                                                                                                      |

## Consequences

- The next run skips memories that the model already kept, unless the user chooses **Select All**.
- A memory that the model could not merge because its partner sat in another batch is marked. **Select All** checks it again.
- A memory that gained many observations keeps its mark. The model sees it again only after a text or category change, or through **Select All**.
- The table travels with `user-profiles.db` in a space backup. A transfer of profile items to another space does not copy marks, so the target starts unchecked.
- The automatic cleanup (ADR-030) shares the batch runner but neither reads nor writes marks.
