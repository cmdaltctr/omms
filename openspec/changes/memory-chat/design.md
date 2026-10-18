## Context

See proposal.md for the motivation. Facts that shape the design:

- **Retrieval:** `memoryClient.searchMemories(query, containerTag, scope)` (`src/services/client.ts:115`) is the hook retrieval path, with the optional reranker. It takes `scope: "all-projects"`. The web UI's `/api/search` skips the reranker. Chat uses `searchMemories`.
- **Model calls:** `buildMemoryProviderConfig` (`src/services/ai/provider-config.ts:20`) checks the external model settings. `AIProviderFactory.createProvider(...).executeToolCall(system, user, toolSchema, sessionId)` returns structured `data` for six provider types. `handleRunTagMigrationBatch` (`src/services/api-handlers.ts:1298`) already calls it from a web handler. There is no streaming, and `stream` is a blocked extra parameter.
- **Tags:** `countKeywords` (`src/services/keyword-counts.ts`) counts the labels in a list of stored tag fields. `GET /api/keywords` uses it.
- **Profile:** profile items carry `category` and centroid vectors (`src/services/user-profile/types.ts`). `handleGetUserProfile` (`api-handlers.ts:933`) loads the active profile.
- **Storage:** `user-prompts.db` sits in `CONFIG.storagePath` and opens through `tursoConnectionManager` (`src/services/user-prompt/user-prompt-manager.ts`). OMMS has no sync between computers. Project tags come from the git remote when there is one (`src/services/tags.ts:241`).
- **Size limits** (`tests/file-size-ceiling.test.ts`): `web-server.ts` is frozen at 1818 lines and `AppSidebar.tsx` at 571, so neither may grow. `App.tsx` has 482 of 500 lines.
- **Code rules:** new code in `src/services/` gets `CONFIG` passed in as an argument. Logs never hold prompts or replies.

## Goals / Non-Goals

**Goals:**

- Cited answers in which every citation is checked against the sources sent.
- A visible search plan, so the user can see which tags and categories were used.
- Conversations in one file that the user can copy to another computer.

**Non-Goals:**

- Streaming answers.
- Hook retrieval changes (a keyword index and profile selection by relevance). That is a separate change.
- Automatic sync or merge between computers. The user copies `chats.db` by hand.
- Using the OpenCode or Pi session model. The web app cannot reach it.
- Chat writing to memories or the profile. Chat only reads.

## Decisions

1. **Two tool calls per question: plan, then answer.** The plan call returns `{ queries: string[1..3], tags: string[], profileCategories: string[] }` through a `plan_search` tool. The answer call returns `{ answer: string, citations: string[], insufficient: boolean }` through an `answer` tool. Tool calls give typed output on all six providers. Alternatives: one call that searches through tools in a loop (slower, harder to bound, and harder to test), or no plan step (loses the tag and category matching the user asked for).
2. **Plan inputs are bounded.** The plan call gets the 200 most frequent tags in the scope with their counts, all profile categories, and the last 6 turns, each cut to 500 characters. The returned tags and categories are matched case-insensitively against these lists. Anything else is dropped.
3. **Retrieval merge.** Run `searchMemories` once per query and once with the chosen tags joined as text. Merge by memory id and keep the best score. Take the top 12 memory sources. For profile sources, take the items in the chosen categories plus the items whose centroid is closest to the question embedding. Merge by item and take the top 6. Run the searches with `Promise.all`.
4. **Citation check in pure code.** `validateCitations(answer, sentLabels)` removes `[Xn]` markers that are not in the sent set and returns the cited labels in order of first use. It sits in its own module with unit tests. An answer with no valid citation and `insufficient: false` is shown with a note that no source was cited.
5. **Storage in `chats.db`.** A new libSQL file in `CONFIG.storagePath`, opened through `tursoConnectionManager`, with two tables:
   - `chat_folders(id, name, name_key UNIQUE, created_at, updated_at)`. `name_key` is the lower-case trimmed name, so names are unique ignoring case.
   - `chat_conversations(id, folder_id NULL, title, scope_tag, created_at, updated_at)`, with `folder_id` referencing `chat_folders` `ON DELETE CASCADE`. Deleting a folder deletes its conversations, and their messages through the next cascade.
   - `chat_messages(id, conversation_id, role, content, sources_json, plan_json, model, error_code, created_at)`, with `ON DELETE CASCADE`

   Sources are saved as snapshots (id, kind, label, text, project name, date, tags, score), so old answers still open after a memory is deleted. Alternatives: `user-prompts.db` (mixes capture state with chat, and ADR-012 limits what that file holds), or browser storage (does not carry over to other devices).

   **The file is portable.** The user moves chats to another computer by copying `chats.db`. So:
   - Everything a conversation needs is in this one file. The store keeps SQLite's default rollback journal and never turns on WAL, so no `-wal` or `-shm` file holds committed data.
   - The file holds no absolute path, user name, or email. Snapshots keep the project name and the project tag, not the project folder.
   - A `chat_meta` table holds `schema_version`. An older OMMS that finds a newer version shows the chats as read-only and says to upgrade. A newer OMMS migrates an older file in place.
   - A conversation's scope is a project tag. OMMS makes the tag from the git remote, so the same repository has the same tag on both computers. When the tag matches no project on this computer, the scope shows "Project not on this computer", saved answers still open from their snapshots, and the next question asks the user to pick a scope.
   - Copy and replace the file while the web app is stopped. The docs say how.

6. **Routes in `src/services/chat/chat-routes.ts`.** The routes are:
   - `GET /api/chat/status`: settings complete or not, and the missing setting names
   - `GET /api/chat/conversations` and `POST /api/chat/conversations`
   - `GET /api/chat/conversations/:id`, `PATCH /api/chat/conversations/:id` (rename or move, body `{ title?, folderId? }`, `folderId: null` moves out of folders) and `DELETE /api/chat/conversations/:id`
   - `POST /api/chat/conversations/bulk-delete`, body `{ ids: string[] }` (1 to 500 ids), in one transaction. Unknown ids fail the request with 404 and nothing is deleted.
   - `GET /api/chat/folders` (with conversation counts), `POST /api/chat/folders`, `PATCH /api/chat/folders/:id` (rename) and `DELETE /api/chat/folders/:id`. A duplicate name returns 409.
   - `POST /api/chat/conversations/:id/messages`, with body `{ question, scopeTag | null }`

   `web-server.ts` reaches them through one combined dispatcher that replaces the current `routeProfileCleanup` call with a list of route modules. This keeps the line count unchanged. The routes keep the existing API-token rule for `/api/*`.

7. **Module split** (each module under 500 lines and tested alone):
   - `chat-store.ts`
   - `chat-plan.ts` (prompt build and plan validation, pure)
   - `chat-retrieve.ts` (search functions passed in)
   - `chat-answer.ts` (prompt build and citation check, pure)
   - `chat-service.ts` (one question end to end, with dependencies passed in)
   - `chat-routes.ts`
8. **Web UI.**
   - The conversation list groups conversations under collapsible folders, then a "No folder" group. Each folder row has New chat, Rename, and Delete. Each conversation row has Rename, Move to folder, and Delete. A Select button turns on select mode with tick boxes, a "Select all in folder" action, a selected count, and Delete selected. All deletes use one confirmation dialog that states the count. The folder dialog and the move menu are separate small components to keep `ConversationList` under 200 lines.
   - `web/src/lib/components/chat/` holds `ChatView`, `ConversationList`, `FolderRow`, `FolderDialog`, `MoveToFolderMenu`, `DeleteChatsDialog`, `MessageThread`, `AnswerBubble`, `CitationChip`, `SourceDialog`, `SearchDetails`, `ChatInput` and `ChatSetupNotice`.
   - Citation markers are split into text and chip parts by a pure parser. No HTML injection.
   - `AppSidebar.tsx` gets a small `SidebarNavLink` component, used by the Project, Profile and Chat links, so the file shrinks.
   - The scope selector reuses the project list from `/api/tags`.
   - On narrow screens, the conversation list opens as a sheet panel.
9. **Timeouts.** Each model call has a 60-second limit. The browser request has a 150-second limit. Leaving the page does not cancel the server work. The answer is saved and shows on return.
10. **Private text.** `stripPrivateContent` and `isFullyPrivate` run on the question before anything else. Earlier turns are already stored stripped.

## Risks / Trade-offs

- [Two model calls make each answer slower, about 2 to 8 seconds] → Show a progress state. The plan step falls back to the question text on failure.
- [The model can still misstate what a cited source says] → Each citation opens its source, and the dialog explains that answers come from the model.
- [Old memories, prompts or evidence may hold OpenCode `<private>` text saved before `fix/tag-match-private-prompts`] → Merge that fix first. A separate cleanup can follow.
- [A copy taken while a question is being answered can miss that answer, and a copy over a running web app can be read part-way] → The docs say to stop the web app on both computers before copying. A Claude Code prompt, OpenCode, or Pi can start the web app again, so the docs say to copy before using them.
- [Copying replaces the other computer's chats, with no merge] → The docs say so. A merge or import command can follow if needed.
- [Projects without a git remote get a tag from their folder path, so the tag differs between computers] → Old answers still open. The user picks a scope for new questions.
- [Memory text is sent to the external model provider] → Capture already does this. The docs and the setup notice name the provider that receives the text.
- [Deleting a folder deletes every chat in it, with no undo] → The confirmation states the count. The docs suggest copying `chats.db` first as a backup. Folders are one level deep, so no hidden subfolders are deleted.
- [`chats.db` grows without limit] → The user deletes conversations. A retention setting can follow if needed.
