# ADR-033: Chat uses the model to plan its search; the hooks do not

- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`memory-chat`](../../openspec/changes/archive/2026-10-18-memory-chat/proposal.md)

## Context

The user asked whether an AI model picks keywords during memory fetch and checks them against the tags and the user profile. Today it does not. Retrieval in every host (`buildRetrievalSection`, `src/core/retrieval.ts`) embeds the raw prompt and scores each memory as 0.6 × content similarity + 0.4 × tag similarity. The profile block is the same for every prompt.

The new chat page needs better targeting than that, and the hooks run on every prompt with a 10-second limit. A model call on every prompt adds delay and cost. Each host also runs its own AI already.

Published comparisons favour a cheap keyword index joined to vector search. Model query rewriting (HyDE, multi-query) gave small or negative gains in the one 2026 benchmark checked (arXiv 2604.01733).

## Decision

1. **The chat plans each search with the external memory model.** A `plan_search` tool call reads the question, the last 6 turns, the 200 most used tags in the scope, and the profile categories. It returns up to 3 search phrases, tags, and categories. Tags and categories that do not exist are dropped. A failed plan falls back to the question text.
2. **The chat answers in a second call** and cites numbered sources. The server removes any citation that was not sent.
3. **The hooks (Claude Code, OpenCode, Pi) make no model call during retrieval.** Better hook search will come from a keyword index merged with vector search, and from choosing profile items by relevance. That is a separate change.

## Consequences

**Positive**

- The user can see which tags and categories a chat used.
- Hook latency and cost stay as they are.

**Negative**

- Each chat question costs two external model calls, about 4 to 5 seconds.
- Chat needs `memoryModel`, `memoryApiUrl`, and `memoryApiKey`. The web app cannot use the OpenCode or Pi session model.
- Hook search keeps its current weak points until the keyword index ships.

**Neutral**

- The live check (2 questions, 4 calls) did not measure tokens. The chat logs no token counts.

## Alternatives Considered

| Option                                         | Rejected because                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Model keywords on every hook prompt            | Adds a call to every prompt in three hosts, for a small measured gain |
| No plan step in chat                           | Loses the tag and category matching the user asked for                |
| One call that searches through tools in a loop | Slower, harder to bound and to test                                   |

## Revisit Triggers

- A hook-search change ships, and chat plan quality can be compared with it.
- Chat answers show weak targeting in small projects. The live check found a vague question in a 10-memory project returned profile items only.
- Token logging is added and cost per question is known.

## References

- [ADR-032](./032-chat-history-lives-in-chats-db.md)
- `src/services/chat/chat-plan.ts`, `src/services/chat/chat-answer.ts`, `src/core/retrieval.ts`
