---
name: omms-memory
description: Search and save OMMS project memory. Use before you debug or investigate a problem, when the user refers to earlier work ("we fixed this before", "last time", "remember", "did we"), and before a decision about project conventions. Use after the user makes a decision, you fix a bug, or the user states a preference.
---

# OMMS project memory

OMMS keeps memories for each project: earlier fixes, decisions, and conventions. At the start of a session OMMS adds the closest matches to the context. That list is partial. Search the full store before you work out an answer again.

## How to call OMMS

- If your tool list has a `memory` tool (Pi and OpenCode), use it.
- If it does not (Claude Code), run the `om-memory-system memory` command with the Bash tool from the project directory. Each command prints one JSON document. A result with `"success": false` has an `error` field.

## When to search

Search first:

- before you debug or investigate a problem;
- when the user refers to earlier work, for example "we fixed this before", "last time", "remember", or "did we";
- before a decision about project conventions, tools, or structure.

With the `memory` tool:

```text
memory({ mode: "search", query: "<keywords>" })
```

With the command:

```bash
om-memory-system memory search "<query>"
```

- Use technical keywords, for example `"database choice"` or `"webhook retry policy"`.
- If the first search finds nothing, try two or three other keyword sets: the error text, the file name, the tool name.
- If the project search finds nothing, search every project: `scope: "all-projects"` with the tool, or `--scope all-projects` with the command.
- Each result has `id`, `content`, `similarity` (0 to 100), and `type` when the memory has one. Add a limit (`limit: N` or `--limit N`) to get fewer results.

## When to save

After the user makes a decision, after you fix a bug, or after the user states a preference, save one short memory.

With the `memory` tool:

```text
memory({ mode: "add", content: "<one or two sentences>", type: "<type>", tags: "<tag1,tag2>" })
```

With the command:

```bash
om-memory-system memory add --content "<one or two sentences>" --type <type> --tags "<tag1,tag2>"
```

- Write the content so that it makes sense without the conversation. Name the files, tools, and reasons.
- Save a personal working preference that applies to all projects with mode `profile` (`om-memory-system memory profile --content "<preference>"`).

Types:

| Type            | Use for                                   |
| --------------- | ----------------------------------------- |
| `decision`      | A choice and its reason                   |
| `bug-fix`       | A bug, its cause, and the fix             |
| `feature`       | A feature that was added                  |
| `refactor`      | A change of structure with no new feature |
| `configuration` | A setting, environment, or build change   |
| `analysis`      | A finding from an investigation           |
| `discussion`    | A conclusion from a discussion            |
| `other`         | Anything else                             |

## Modes

| Mode          | Options                                                      |
| ------------- | ------------------------------------------------------------ |
| `search`      | query, limit, scope                                          |
| `add`         | content, type, tags                                          |
| `list`        | limit, scope                                                 |
| `forget`      | the memory id                                                |
| `profile`     | no options to show the profile; content to save a preference |
| `list-shards` | none                                                         |
| `migrate`     | the old path or hash, dry run                                |
| `export`      | the output file                                              |
| `import`      | the input file, dry run                                      |
| `help`        | none                                                         |

The command takes each option as a flag, for example `--query`, `--limit`, `--scope`, `--id`, and `--directory <path>` for a different project. Run `om-memory-system memory --help` for the full list.

## Safety

- Never store secrets: API keys, tokens, passwords, or private keys.
- OMMS removes text inside `<private>...</private>` tags before storage. Content that is fully private is not stored.
- Do not use `forget` unless the user asks you to remove a memory.
