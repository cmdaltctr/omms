# Tasks

## 1. Chat store

- [x] 1.1 Write failing tests for `src/services/chat/chat-store.ts`: create, list (newest first), rename, and delete a conversation; append messages with source snapshots and plan data; delete cascades to messages; create, rename, and delete folders; duplicate folder names ignoring case are refused; start a conversation in a folder and move it in and out; deleting a folder deletes its conversations and their messages; bulk delete removes several conversations in one transaction and deletes nothing when one id is unknown; no `-wal` file exists after writes; stored rows hold no absolute path or email; a file copied to a new folder opens with all conversations; a file with a newer `schema_version` opens read-only. Verify: tests fail before 1.2.
- [x] 1.2 Implement `chat-store.ts` on `chats.db` in the storage path passed in, through `tursoConnectionManager`. Verify: 1.1 passes under `bash scripts/run-tests-isolated.sh`.
- [x] 1.3 Write ADR "Chat history lives in chats.db" in `docs/adr/` and add it to the ADR index. Verify: Prettier passes.

## 2. Search plan

- [x] 2.1 Write failing tests for `chat-plan.ts`: the prompt holds the question, at most 6 cut turns, at most 200 tags, and the categories; unknown tags and categories are dropped case-insensitively; queries are capped at 3; an empty or broken plan falls back to the question text. Verify: tests fail before 2.2.
- [x] 2.2 Implement `chat-plan.ts` (pure) and the `plan_search` tool schema. Verify: 2.1 passes.

## 3. Retrieval

- [x] 3.1 Write failing tests for `chat-retrieve.ts` with fake search functions: one search per query plus one for tags; merge by id with the best score; limits of 12 memories and 6 profile items; profile items from the chosen categories plus the closest by vector; project scope versus all projects. Verify: tests fail before 3.2.
- [x] 3.2 Implement `chat-retrieve.ts` over `memoryClient.searchMemories` and the active profile, with the search functions passed in. Verify: 3.1 passes.

## 4. Answer and citations

- [x] 4.1 Write failing tests for `chat-answer.ts`: sources numbered `S1…` and `P1…`; `validateCitations` removes unknown labels and keeps first-use order; `insufficient` is passed through; no answer call when there are no sources. Verify: tests fail before 4.2, and each mutation of the citation filter fails a test.
- [x] 4.2 Implement `chat-answer.ts` (pure) and the `answer` tool schema. Verify: 4.1 passes.

## 5. Chat service and routes

- [x] 5.1 Write failing tests for `chat-service.ts` with fake provider, search, and store: private text is stripped before the model and the store; a fully private question is refused without a model call; plan failure falls back and is recorded; an answer failure saves the question with an error code; logs hold no question or answer text; errors hold no API key. Verify: tests fail before 5.2.
- [x] 5.2 Implement `chat-service.ts` with `CONFIG` passed in, using `buildMemoryProviderConfig` and `AIProviderFactory`, with a 60-second limit per call. Verify: 5.1 passes.
- [x] 5.3 Write failing route tests for `chat-routes.ts`: status lists missing settings without values; list, create, get, rename, move, delete, bulk delete, and ask; folder list with counts, create, rename (409 on duplicate), and delete; 404 for an unknown conversation; 400 for an empty question. Verify: tests fail before 5.4.
- [x] 5.4 Implement `chat-routes.ts` and replace the `routeProfileCleanup` call in `web-server.ts` with a route-module list that includes chat. Verify: 5.3 passes, the existing profile-cleanup route tests pass, and `tests/file-size-ceiling.test.ts` passes.

## 6. Sidebar and route

- [x] 6.1 Write a failing spec: `/chat` resolves to the chat view, and the sidebar shows a Chat link that is marked current on `/chat` and labelled when collapsed. Verify: the spec fails before 6.2.
- [x] 6.2 Add `chat` to `web/src/lib/routes.ts`, add a `SidebarNavLink` component and use it for the Project, Profile, and Chat links in `AppSidebar.tsx`, and wire `ChatView` into `App.tsx`. Verify: 6.1 passes, existing sidebar and navigation specs pass, and the file-size test passes.
- [x] 6.3 Add the translation keys for chat to English, Chinese, and Arabic. Verify: the translation parity test passes.

## 7. Chat page

- [x] 7.1 Write a failing unit test for the citation parser: text and `[S1]` markers split into parts, unknown markers kept as text, and markup kept as text. Verify: the test fails before 7.2.
- [x] 7.2 Implement the parser and the `ChatView`, `ConversationList`, `FolderRow`, `FolderDialog`, `MoveToFolderMenu`, `DeleteChatsDialog`, `MessageThread`, `AnswerBubble`, `CitationChip`, `SourceDialog`, `SearchDetails`, `ChatInput`, and `ChatSetupNotice` components with a typed API client. Verify: 7.1 passes, plus render specs for the setup notice (input disabled, missing names shown), a citation opening its source, a deleted-source note, search details, error with retry, a folder delete confirmation that states the chat count, select mode with Space to tick and a count of selected, and the open chat being deleted.
- [x] 7.3 Write `docs/web-ui-chat.md`: setup, scope, how the search plan works, citations, where chats are stored, how to copy `chats.db` to another computer (stop the web app on both, copy, start; copying replaces the other computer's chats; projects without a git remote need a new scope), and that memory text goes to the external model provider. Add it to `docs/README.md` and link it from `docs/web-ui.md`. Verify: Prettier passes.
- [x] 7.4 Add folders, moving chats, and deleting several chats to `docs/web-ui-chat.md`, and say that deleting a folder deletes its chats with no undo. Verify: Prettier passes.

## 8. Check

- [x] 8.1 Browser check against synthetic fixture data with a fake model: desktop and 390 px widths, light and dark themes, Arabic, keyboard use of citation chips and dialogs, a long conversation, folders (create, move, delete with chats), and multi-select delete. Verify: screenshots, with each check reported as PASS, FAIL, or NOT RUN.
- [x] 8.2 Live check against the real web app with the DeepSeek settings: ask one question in one project and one across all projects; confirm every citation opens a real source; confirm `~/.omms/omms.log` holds no question or answer text. Verify: report the results.
- [x] 8.3 Run `bun run ci:local`. Verify: exit 0.

## Verification notes

- Mutation checks:
  - The citation filter (`validateCitations`): keeping unknown labels, dropping the de-duplication, or matching any bracketed word each made `tests/chat-answer.test.ts` fail.
  - Folder delete: changing `ON DELETE CASCADE` to `SET NULL` on `folder_id` made the folder-delete test in `tests/chat-store.test.ts` fail.
  - Citation chip and retry wiring: removing either handler made `web/tests/chat-components.spec.tsx` fail.
- 8.1 browser check. Synthetic fixture on port 5179 with a fake chat backend (`web/tests/visual/chat-fixtures.ts`). No store and no model. Chrome DevTools, isolated context:
  - PASS desktop 1280 px, dark: Chat link is the current page, the folders and No folder groups list with counts, the answer shows chips, Sources, and How I searched, and the provider host shows under the input. No horizontal scroll.
  - PASS keyboard: Enter on a chip opens the source dialog, Escape closes it, and focus returns to the chip. A deleted source shows the saved-text notice and a struck-through chip.
  - PASS long conversation: 4 turns with 24 chips. The thread scrolls and the input stays in view.
  - PASS folders: create `Papers`; `papers` is refused with "A folder with this name exists". Move a chat into `Papers` through its menu. Deleting `Thesis` asks "The folder "Thesis" and its 2 chats will be deleted…", then removes the folder and both chats.
  - PASS multi-select: Space ticks the focused chat, the count reads "2 selected", and the confirmation says "2 chats will be deleted…". The open chat was among them, so the page showed an empty new chat. Select mode turned off afterwards.
  - PASS asking: Enter sends, the new chat takes its title from the question, and the answer shows chips.
  - PASS 390 px, light: no horizontal scroll, and the chat list opens as a 320 px panel that closes when a chat is opened.
  - PASS Arabic: the page is right to left, the panel opens from the right, and the labels are translated. The chat title beside **Chats** needed `dir="auto"`; fixed.
  - PASS Chinese: the duplicate folder error was the server's English text; fixed to the translated message and rechecked.
  - Hover colours on chips and folder rows were checked through their classes; a real mouse hover was NOT RUN.
- 8.2 PASS with one finding. Run on 2026-10-18 with user approval, from this branch on a second web app (loopback port 4799) against the real store and `deepseek-flash` with reasoning off. Two questions, four model calls.
  - Project scope (`om-pi-todo`, 10 memories): answered in 4.2 s. The search returned profile items only, no memory sources, so the model said the sources do not answer the question and cited two profile items. The answer wandered into other projects through the profile items. Not a spec failure, but a quality point: a vague question in a small project gets profile items only.
  - All projects: answered in 5.2 s with 12 memory and 6 profile sources. The plan chose real tags (`omms`, `om-memory-system`, `retrieval`). The answer cited S1, S3, S7 and S12. All four exist in the store and their saved text matches.
  - Every citation label in both answers was in the set of sources sent.
  - `omms.log`: two `chat:` lines holding only counts, timings and ids. No question or answer text.
  - `chats.db`: one file, no `-wal` or `-shm` file, no email address, no path in the title, project name or project tag.
  - FINDING, resolved: `chats.db` contains `/Users/…` text inside saved source snapshots, copied from the user's own memory text (one memory names a worktree path and a config path). The user chose to reword the requirement: the chat's own fields hold no paths, user names, or emails; snapshot text stays as written so a citation matches its answer; the docs and ADR-032 warn that the file must stay out of Git and must not be shared. A test now checks that memory text with a path is kept unchanged.
  - Cost: the chat does not log token counts, so none were measured. Each answer call sends at most 18 sources of 2,000 characters.
- 8.3 PASS: `bun run ci:local` exited 0, no failing test file.
