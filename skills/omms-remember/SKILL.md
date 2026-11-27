---
name: omms-remember
description: Save a short session snapshot in OMMS from the current context, then report its ID. Use when the user asks to memorise, remember, or save this session, its progress, or its next steps for a later session. Do not read session history or transcript files.
---

# OMMS session snapshot

Save a short snapshot of the current session in OMMS. Use plain British English and short sentences. A fresh agent can then recall the work without the chat history.

Do not ask the user questions. Do not write a handover file or a paste-ready prompt.

## Check the note length

Do this before you write. Read the note length with the `memory` tool in mode `help`. When no `memory` tool is listed, run `om-memory-system memory help`.

```text
memory({ mode: "help" })
```

Read `memorisation.length` in the reply. It is `short`, `medium`, `long` or `custom`. `memorisation.maxSize` and `memorisation.unit` give the cap. Size the note by the length:

- `short`: at most 3 bullets in each section.
- `medium`: at most 5 bullets in each section.
- `long`: at most 8 bullets in each section, and an optional Context section.
- `custom`: size the note to the cap.

If `help` fails, write a medium note.

## Write the snapshot

1. Use only what you already hold in the current context. Do not read session history, transcripts, logs, or prior conversation exports.
2. You may run cheap read-only git commands to confirm the current branch and head commit. Do not inspect diffs, logs, or history to rebuild the session.
3. Fill these fields from the current context:
   - `topic`: one short line naming the project, change, or subject.
   - `done`: completed work as a Markdown `-` bullet list, one fact per bullet, with task IDs or file names where useful.
   - `doing`: work in progress as a Markdown `-` bullet list. Leave it out when nothing is in progress.
   - `next`: the next actions and any gate that blocks them, as a Markdown `-` bullet list.
4. Omit empty fields. Follow the note length rules above. Keep the whole snapshot short enough to stay under the configured memorisation size cap. OMMS never shortens it for you.
5. Never store secrets: API keys, tokens, passwords, private keys, or other credentials. Do not copy raw secret-bearing output into any field.

## Save with memorise

If your tool list has a `memory` tool, use it. Pi and OpenCode call it `memory`. Claude Code with the OMMS plugin calls it `mcp__omms__memory`.

```text
memory({
  mode: "memorise",
  topic: "<project, change, or subject>",
  done: "<completed work>",
  doing: "<work in progress>",
  next: "<next actions and gates>"
})
```

Use `mode: "memorise"` with only the fields that have content. Do not add a transcript or a long conversation summary.

When the user supplies text to memorise, save that text with `content` instead of inventing snapshot fields:

```text
memory({ mode: "memorise", content: "<text the user names>" })
```

Text the user dictates word for word is saved unchanged, whatever the note length. Do not shorten it, reformat it or add sections.

Send `content` or the snapshot fields in one call, never both. The tool refuses a call with both. Dictated text always goes in `content`, even when it has done, doing and next parts, because snapshot fields add headings. When the user gives done, doing and next parts and does not ask for exact text, put them in the snapshot fields.

## Write a note

When you compose a `content` note from context, for example a decision the user asks you to memorise, write a Markdown note. Put a one-line plain title first. Then add `##` sections with bullet lists. Write no paragraph longer than two sentences. Follow the note length rules above.

```text
Use SQLite for the web cache

## Decision
- Store the web cache in SQLite.

## Why
- One file, no server.
- Tests run without setup.

## Plan
- Add the table in the next change.
- Remove the JSON cache after one release.
```

## Labels

Every memorisation can carry labels. Labels are the `tags` argument, a comma-separated list.

- When the user names labels, for example "memorise this, label it release, wip", pass every label the user names in `tags`, exactly as written. Never drop, reword or merge a user label.
- Add 1 to 3 labels of your own that describe the topic. Keep them short and lower-case. Do not repeat a label the user gave.
- When the user names no labels, still add 1 to 3 labels of your own.
- Do not put `memorisation` in `tags`. OMMS adds that fixed tag itself.

```text
memory({
  mode: "memorise",
  topic: "<topic>",
  next: "<next actions>",
  tags: "<user labels as written>,<your 1 to 3 labels>"
})
```

With the command, add `--tags "<labels>"`:

```bash
om-memory-system memory memorise --topic "<topic>" --next "<next>" --tags "release,wip,auth"
```

Use the `om-memory-system memory` command only when no `memory` tool is listed. Run it from the project directory:

```bash
om-memory-system memory memorise --topic "<topic>" --done "<done>" --doing "<doing>" --next "<next>"
```

For text the user supplies:

```bash
om-memory-system memory memorise "<text>"
```

Each command prints one JSON document. A result with `"success": false` has an `error` field. If the snapshot exceeds the size cap, shorten the fields and retry. Report the error if the save still fails.

## Report and recall

Tell the user the returned `ms-` ID. Say they can recall the snapshot later by quoting that ID, by asking about its topic, or by asking for a label.

To recall by label, use `recall` with `tags`. Only a memorisation that carries every label matches. Add `query` to narrow by text as well. With `tags` and no `query`, recall returns the newest matches. Use this when the user asks for "the memorisation labelled X".

```text
memory({ mode: "recall", tags: "<label1,label2>" })
```

With the command:

```bash
om-memory-system memory recall --tags "<label1,label2>"
```

Use mode `recall` when the user quotes a memorisation ID or asks what was planned or memorised, for example "what were we gonna do with the release notes" or "what did I memorise". Use mode `search` for other questions about earlier work.

```text
memory({ mode: "recall", query: "<ms- ID or topic>" })
```

With the command:

```bash
om-memory-system memory recall "<ms- ID or topic>"
```

## Invocation names

- Claude Code: `/omms:omms-remember`
- Pi: `/skill:omms-remember`
- OpenCode: `/omms-remember`
