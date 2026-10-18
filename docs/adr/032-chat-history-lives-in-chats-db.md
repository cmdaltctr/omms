# ADR-032: Chat history lives in chats.db

- **Date:** 2026-10-18
- **Status:** Accepted
- **Deciders:** Aizat Hawari
- **Change:** [`memory-chat`](../../openspec/changes/memory-chat/proposal.md)

## Context

The web UI gains a chat page that answers questions from stored memories and the user profile. Conversations, their folders, the answers, the cited sources, and the search plan must outlive a restart. The user moves chats to another computer by copying a file by hand. OMMS has no sync between computers.

## Decision

1. **One libSQL file, `chats.db`, in the storage path.** It holds `chat_meta`, `chat_folders`, `chat_conversations`, and `chat_messages`. It opens through the shared connection manager like the other stores.
2. **The file is self-contained.** It keeps SQLite's default rollback journal and never turns on WAL, so a copy of `chats.db` alone carries every committed conversation.
3. **No personal data in the file.** Source snapshots keep an allow-listed set of fields: label, kind, id, text, project name, project tag, date, tags, score, and for profile items the section, category, and evidence. Folder paths, user names, and emails are never written.
4. **Sources are snapshots.** Each answer saves the text it cited, so an old answer still opens after its memory is deleted or on a computer that never held that memory.
5. **Schema version in `chat_meta`.** A file from a newer OMMS opens read-only. An older file is updated in place.
6. **Folders are one level deep and own their chats.** `folder_id` references `chat_folders` with `ON DELETE CASCADE`, and messages cascade from conversations, so deleting a folder deletes its chats in one statement.

## Alternatives rejected

- **`user-prompts.db`.** It holds capture state, and ADR-012 limits what it may hold. Mixing chat history in would blur both rules.
- **Browser storage.** It does not leave the browser, so a copy to another computer is not possible.
- **WAL journal.** Better concurrent reads, but a copy of `chats.db` without its `-wal` file can lose recent answers.
- **Automatic sync.** Out of scope; the user copies the file by hand while the web app is stopped.
