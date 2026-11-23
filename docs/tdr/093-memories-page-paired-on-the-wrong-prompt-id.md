# TDR-093: The Memories page paired on the wrong prompt ID

**Date:** 2026-11-21
**Status:** Accepted
**Deciders:** Aizat Hawari
**Tags:** web-ui, memories-page, capture, user-prompts

## Context

On 2026-11-21 the Memories page opened on turns from 2026-11-04. Newer turns did not show on the first page.

Capture still worked. `user-prompts.db`, `skills.db` and the project shards held rows up to the same evening. `GET /api/memories` returned the old turns first, so the fault was in the list code, not in the store.

The user profile was not affected. Profile learning had analysed every prompt up to 2026-11-21. `GET /api/user-profile` returned version 1155, last analysed on 2026-11-21.

### Root Cause Analysis

The list shows each memory beside the prompt it came from. `handleListMemories` (`src/services/api/memory-list.ts`) paired a memory with a prompt only when the memory's `metadata.promptId` equalled the prompt row's `id`.

Two capture paths store a different value in `metadata.promptId`. They store the host's entry ID (`window.userEntryId`), which is `user_prompts.message_id`, not the prompt row ID:

| Path                       | Since                                           |
| -------------------------- | ----------------------------------------------- |
| Pi live capture            | The Pi adapter, `4fe5e7b0`, 2026-09-20          |
| Claude Code turn units     | Skill learning, `f801fdda`, v4.31.0, 2026-10-31 |
| History import turn output | Skill learning, `f801fdda`, v4.31.0, 2026-10-31 |

`live-captured-entries.ts` reads `metadata.promptId` as a host entry ID on purpose, so the field now has that meaning.

The prompt row still links to its memory. Capture calls `linkMemoryToPrompt`, which writes `user_prompts.linked_memory_id`. The list code did not use that link.

A memory that found no prompt became a single item. The list put every pair first, sorted by time, and every single item after the last pair. The last pair the old rule could match was from 2026-11-04, so the first page stopped there. On the live store, 234 memories paired. 974 newer memories and their prompts sat behind the pairs.

Cascade delete had the same fault. `handleDeleteMemory` deleted the prompt named in `metadata.promptId`. For a newer memory that ID is a host entry ID, so the prompt stayed. The reply still said `deletedPrompt: true`.

## Decision

Fixed in PR #305.

1. Pair a memory and a prompt on `user_prompts.linked_memory_id`. Keep the `metadata.promptId` match as a fallback for older rows.
2. Sort pairs and single items together by time. A newer single item goes above older pairs.
3. A cascade delete also deletes every prompt whose `linked_memory_id` is the memory ID (`deletePromptsLinkedToMemory`). `deletedPrompt` is true only when a prompt was targeted.

`metadata.promptId` keeps the host entry ID. Capture and skill learning are unchanged.

## Consequences

### Positive

- The first page opens on the newest turns. On the live store, 4,147 memories pair with their prompts.
- A cascade delete removes the prompt of a newer memory.

### Negative

- `metadata.promptId` holds a prompt row ID on old memories and a host entry ID on newer ones. Code that reads it must not assume either meaning.

### Neutral

- No data migration. The link that the list needs was already stored.

## Alternatives Considered

| Option                                                   | Rejected Because                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Store the prompt row ID in `metadata.promptId` again     | `live-captured-entries.ts` needs the host entry ID there. It would break capture dedupe. |
| Rewrite old memories so every `promptId` has one meaning | A migration of every shard for a field the list does not need.                           |
| Pair on `metadata.promptId` = `user_prompts.message_id`  | The prompt row already holds the exact link. A message ID can repeat across hosts.       |

## How to Recognise / Handle This Again

1. The Memories page shows old turns first, and the newest turns are on later pages.
2. Compare the newest `created_at` in `user_prompts.db` with the first item of `GET /api/memories`. The store is newer.
3. Check whether the newest memories' `metadata.promptId` equals any `user_prompts.id`. If it equals `message_id`, the list is pairing on the wrong field.

## Revisit Triggers

- Capture stops writing `linked_memory_id`.
- A new capture path writes a memory without calling `linkMemoryToPrompt`.

## References

- PR #305
- `src/services/api/memory-list.ts`, `src/services/api/memory-write.ts`, `src/services/storage/user-prompts.ts`
- `src/services/live-captured-entries.ts`
- `tests/memory-timeline-orphan.test.ts`
