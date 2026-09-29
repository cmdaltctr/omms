---
name: omms-memory
description: Search and save OMMS project memory with the om-memory-system command. Use before you answer a question about past decisions, conventions, or earlier fixes in this project. Use after the user makes a decision, you fix a bug, or the user states a preference.
---

# OMMS project memory

OMMS keeps memories for each project. Hooks already add relevant memories to the session and capture each finished turn. Use this skill to search or save a memory at once.

Run each command in the Bash tool from the project directory. Each command prints one JSON document. A result with `"success": false` has an `error` field.

## When to search

Before you answer a question about past decisions, conventions, or earlier fixes in this project, search first:

```bash
om-memory-system memory search "<query>"
```

- Use technical keywords, for example `"database choice"` or `"webhook retry policy"`.
- Each result has `id`, `content`, `similarity` (0 to 100), and `type` when the memory has one.
- Add `--limit N` to get fewer results. Add `--scope all-projects` to search every project.

## When to save

After the user makes a decision, after you fix a bug, or after the user states a preference, save one short memory:

```bash
om-memory-system memory add --content "<one or two sentences>" --type <type> --tags "<tag1,tag2>"
```

- Write the content so that it makes sense without this conversation. Name the files, tools, and reasons.
- Save a personal working preference that applies to all projects with `memory profile --content "<preference>"`.

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

| Mode          | Options                                                          |
| ------------- | ---------------------------------------------------------------- |
| `search`      | `"<query>"` or `--query`, `--limit`, `--scope`                   |
| `add`         | `--content`, `--type`, `--tags`                                  |
| `list`        | `--limit`, `--scope`                                             |
| `forget`      | `--id <memory id>`                                               |
| `profile`     | no options to show the profile; `--content` to save a preference |
| `list-shards` | none                                                             |
| `migrate`     | `--from-path` or `--from-hash`, `--dry-run`                      |
| `export`      | `--output <file>`                                                |
| `import`      | `--input <file>`, `--dry-run`                                    |
| `help`        | none                                                             |

All modes accept `--directory <path>` to use a different project. Run `om-memory-system memory --help` for the full list.

## Safety

- Never store secrets: API keys, tokens, passwords, or private keys.
- OMMS removes text inside `<private>...</private>` tags before storage. Content that is fully private is not stored.
- Do not use `forget` unless the user asks you to remove a memory.
