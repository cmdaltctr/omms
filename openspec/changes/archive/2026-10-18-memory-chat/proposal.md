## Why

The web UI lets the user browse and search memories one card at a time, but it cannot answer a question across them. The user wants to ask OMMS questions in plain words and get answers that cite the memories and profile items they come from, so each claim can be checked.

## What Changes

- A **Chat** item in the left sidebar opens a new chat page.
- The user asks a question, in one project or across all projects. OMMS answers from stored memories and the user profile only.
- Each question runs two calls to the external memory model (`memoryModel`, `memoryApiUrl`, `memoryApiKey`):
  1. **Plan:** the model reads the question, the recent turns, the store's real tag list, and the profile categories. It returns search phrases, the tags, and the profile categories to use. Tags and categories that do not exist are dropped.
  2. **Answer:** the model writes the answer from the numbered sources found, and cites them with markers such as `[S1]` and `[P2]`.
- The server drops any citation that points to a source it did not retrieve. With no sources, chat says it found nothing and does not call the answer step.
- Citations show as clickable chips. A chip opens the source: memory text, project, date, and tags, or the profile item with its evidence.
- Each answer shows "How I searched": the phrases, tags, and categories the plan chose.
- Conversations are saved in one file, `chats.db`, in the OMMS data folder. The user can copy that file to another computer and see the same conversations there. The user can rename and delete conversations.
- Conversations can be grouped in folders, one level deep. The user can create, rename, and delete folders, start a new chat inside a folder, and move a chat between folders. Deleting a folder deletes every chat in it, after a confirmation that states the count.
- A select mode lets the user tick several chats, across folders, and delete them in one action.
- When the external memory model is not set, the chat page explains which settings are missing and links to Settings. The input is disabled.
- No streaming. The answer arrives in one piece, with a progress state while it is prepared.
- No change to retrieval in the Claude Code, OpenCode, or Pi hooks. That is a separate change.

## Capabilities

### New Capabilities

- `web-memory-chat`: asking questions about stored memories and the user profile in the web UI, with cited answers and saved conversations.

### Modified Capabilities

None.

## Impact

- Backend: new modules under `src/services/chat/` (store, plan, retrieval, answer, routes). One dispatch line in `src/services/web-server.ts`, offset so the file does not grow past its frozen size.
- Storage: a new `chats.db` in the OMMS data folder (`CONFIG.storagePath`). It is self-contained, so it can be copied between computers. The chat adds no absolute path, user name, or email of its own. Saved sources keep memory text as written, so the file can hold paths that appear in the user's memories and must not be shared.
- Web UI: `web/src/lib/routes.ts`, `web/src/App.tsx`, `web/src/lib/components/explorer/AppSidebar.tsx` (frozen size, needs a small extraction), new components under `web/src/lib/components/chat/`, translations in English, Chinese, and Arabic.
- Model cost: two external model calls per question.
- Docs: a new `docs/web-ui-chat.md`, an entry in `docs/README.md`, and an ADR for chat storage.
- All hosts share the web app, so the feature works the same for Claude Code, OpenCode, and Pi users. No adapter changes.
