# Chat page

The chat page answers your questions from your stored memories and your user profile. Each answer cites the sources it used, so you can check every claim.

Select **Chat** in the sidebar, or open `http://127.0.0.1:4747/chat`.

## Setup

Chat uses the external memory model only. Set these in **Settings**:

- `memoryProvider` (default `openai-chat`)
- `memoryModel`
- `memoryApiUrl`
- `memoryApiKey`

When a setting is missing, the chat page names it, links to Settings, and disables the question box. It never shows a key value.

The OpenCode and Pi session models are not used. The web app cannot reach them.

**Privacy.** Your question and the text of the memories and profile items found are sent to the provider at `memoryApiUrl`. The page names that host under the question box. Text inside `<private>` tags is removed from a question before it is sent or saved. A question that is all private text is refused.

While **Record agent turns** is on in [Skill learning](skill-learning.md), the chat also sends skill counts and short change summaries to the same host, and the page says so under the question box. The chat never sends turn text. See [Skill facts](#skill-facts).

## Asking a question

1. Choose **Search in**: one project, or **All projects**.
2. Type the question and press Enter, or select **Ask**. Shift+Enter adds a new line.
3. Wait for the answer. It takes about 2 to 8 seconds and arrives in one piece.

Each question makes two model calls:

1. **Plan.** The model reads your question, the last few turns, the tags in the scope, and your profile categories. It returns up to 3 search phrases and the tags and categories to use. Tags and categories that do not exist are dropped.
2. **Answer.** OMMS searches with each phrase and the chosen tags, takes up to 12 memories and 6 profile items, and numbers them. The model answers only from these sources and cites them. While skill facts are on, up to 6 skill sources join them.

When OMMS finds no memory, profile item or skill source, it says so and makes no answer call.

## Skill facts

Skill facts answer questions such as "which skills need work?" or "what changed in `s-web-search`?". They are on only while **Record agent turns** is on in [Skill learning](skill-learning.md). A project config cannot turn them on. With recording off, the chat sends and saves exactly what it did before.

How OMMS picks skills:

1. The plan sees the names of up to 100 skills, most used first, and no counts. It can name skills and set a skill question type: **skills that need work** (skills with at least one failed turn, highest attention first), **most used skills** (skills with at least one use), or none.
2. Skills the plan names come first. The question type fills the rest, up to 6 skills. If the plan call fails, OMMS looks for skill names in your question instead. A name must match a whole word, ignoring case, and have 3 or more characters.
3. Two skills with the same name give one source: the one with more uses.

Each skill source holds the uses and failed turns in the last 30 days in all projects, the attention score, whether an applied proposal is in place, the date it was last applied, and up to 5 recent changes (kind, date, who applied it, and a short summary). It holds no turn text, tool output, file path or proposal id.

OMMS scrubs every summary and skill name before it sends or saves them, whatever **Remove private text and secrets** says. The scrub removes `<private>` text and secrets, replaces your home folder, your user name, every absolute path and every email address, and cuts a summary to 200 characters. A skill name that the scrub would change is not used. The scrub is a filter. A summary can still name a person or a project in plain words.

If `skills.db` is from a newer OMMS or cannot be read, the question still gets an answer from memories. **How I searched** then says that the skill facts could not be read.

## Reading answers

Answers show Markdown: bold text, headings, bullet lists, and numbered lists. Bold text, headings, bullets, and numbers use the primary colour. Headings stay small, so an answer never gets a large title. On a wide screen, the chat list stays in view while a long chat scrolls.

## Citations

Answers cite memories as `S1`, `S2`, …, profile items as `P1`, `P2`, …, and skills as `K1`, `K2`, …. A legend above the chat names each letter. It shows `K` while skill facts are on, or when the open chat holds a skill source. OMMS removes any citation to a source it did not send.

- Select a citation to open its source. A memory shows its text, project, date, and tags. A profile item shows its section, category, description, and evidence. A skill shows its uses, failed turns, attention and whether it is modified (**Yes** means an applied proposal is in place), then its recent changes.
- Below each answer, **Sources** lists every cited source.
- **How I searched** shows the phrases, tags, categories, skills and skill question type the plan used. It also says when the plan was skipped and OMMS searched with your question alone.
- A note shows when the sources do not answer the question, or when an answer cites no source.

The model writes the answer, so it can still misstate a source. Open the source before you rely on a claim.

If a cited memory is deleted later, its citation is struck through. The source still opens with the text saved with the answer. A skill that the ranking no longer lists is struck through the same way, and its source says "This skill is no longer listed." The check is skipped, with no error, when skill facts are off or the ranking cannot be read.

## Errors

When the model call fails, the answer shows the error code and a **Retry** button. Your question stays in the chat. Retry runs the question again without a second copy.

## Folders

Group chats in folders. Folders are one level deep.

- **New folder** creates a folder. Names have 1 to 80 characters. Two folders cannot have the same name, ignoring case.
- The **+** button on a folder starts a new chat in that folder.
- The pencil button renames a folder.
- Each chat's **⋯** menu moves it to a folder, or to **No folder**, and renames or deletes it.

## Deleting chats

- Delete one chat from its **⋯** menu.
- Select **Select** to tick several chats, in one folder or across folders. **Select all in folder** ticks a whole folder. **Delete selected** deletes them all.
- The bin button on a folder deletes the folder **and every chat in it**.

Every delete asks first and states how many chats will go. A delete removes all the chats or none. There is no undo. Copy `chats.db` first if you may want the chats back.

## Where chats are stored

Chats, folders, answers, cited sources, and search plans are saved in one file: `~/.omms/data/chats.db` on macOS, or `%USERPROFILE%\.omms\data\chats.db` on Windows (the `storagePath` folder). The chat adds no folder paths, user names, or email addresses of its own, and a skill source holds none (see [ADR-038](adr/038-chat-reads-skill-facts-from-skills-db.md)). Cited sources keep the memory text exactly as it was when the answer was written, so the file can hold folder paths and other text from your memories. Keep it out of Git and do not share it. See [ADR-032](adr/032-chat-history-lives-in-chats-db.md).

## Moving chats to another computer

Copy `chats.db` by hand. OMMS does not sync it.

1. Stop the web app on both computers with the power button.
2. Copy `chats.db` from the `storagePath` folder (`~/.omms/data` on macOS, `%USERPROFILE%\.omms\data` on Windows) to the same folder on the other computer.
3. Start the web app on the other computer.

Do not send a prompt in Claude Code, OpenCode, or Pi while you copy. Any of them can start the web app again.

Copying **replaces** the other computer's chats. The two sets are not merged.

A chat's project is matched by the project's git remote, so a project with the same remote works on both computers. When the project is not on the other computer, the chat shows **Project not on this computer**. Old answers still open, and you choose a new scope before the next question. A project without a git remote gets a different identity on each computer, so it needs a new scope too.

A `chats.db` from a newer OMMS opens read-only, with a note to upgrade. A file from an older OMMS is updated in place.
