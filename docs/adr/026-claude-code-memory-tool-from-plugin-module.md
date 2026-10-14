# ADR-026: Claude Code gets a memory tool from the plugin module

**Date:** 2026-10-13
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

In Claude Code, OMMS worked, but the user could not see it.

- Recall went into hidden context. The chat showed nothing.
- Claude Code had no `memory` tool. The `omms-memory` skill told Claude to run `om-memory-system memory` through Bash ([ADR-016](./016-one-memory-skill-for-every-host.md)). The chat showed "Ran 3 shell commands". In OpenCode and Pi, each memory search is a tool row that the user can unfold.
- The plugin already loads one module for the status line ([ADR-019](./019-claude-code-status-line-through-a-plugin-module.md)). A module can register a tool with `$.tool.register`. Claude sees it as `mcp__<plugin>__<name>`.
- The plugin has no MCP server ([ADR-013](./013-claude-code-host-through-hooks-and-web-app.md)). A global install is optional. The hooks run the plugin launcher ([ADR-018](./018-newest-copy-runtime.md)).
- A prototype mod on Claude Code 2.1.296 showed two facts. A tool behind tool search lost to the skill's Bash route. With `isDeferred: false` and a description that says "use this instead of Bash", Claude called the tool ([TDR-045](../tdr/045-claude-code-module-loading-and-tool-placement.md)).

## Decision

1. **The plugin module registers a `memory` tool.** Claude sees it as `mcp__omms__memory`. It is a plugin tool, not an MCP server.
2. **The tool runs the launcher.** The argv is `node <plugin root>/bin/omms-launch.mjs --at-least-own-version memory <mode> <flags>`. It runs in the session's folder with a 60-second limit. No shell runs, so no input can inject a command.
3. **A fixed list of modes.** `search`, `add`, `list`, `profile`, `forget` and `help`. The tool refuses `import`, `export`, `migrate` and `list-shards`, because they move or rewrite whole stores and files.
4. **The tool is in the prompt from the start.** `isDeferred: false`, and the description says to use the tool instead of the Bash command.
5. **Recall shows as fold rows.** The module reads the context that the hooks inject, and draws one `▸ ● memory [mode=…]` row for each recall at the top of the next reply. It runs no second retrieval.
6. **The skill names the tool.** This narrows ADR-016 Decision 1. Claude Code uses `mcp__omms__memory` when the tool is listed. It runs the command only when no tool is listed, for example with hand-written hooks.
7. **One module entry owns `session.start`.** `hooks/hooks.json` lists `hooks/omms.jsx`. It registers the status label, the tool and the recall rows from their own files. Claude Code allows one `session.start` hook per plugin, so the entry owns it.
8. **The minimum is Claude Code 2.1.295.** The recall rows need it. The tool and the status line work from 2.1.287.

## Consequences

### Positive

- Every memory call and every recall shows in the chat, as in OpenCode and Pi.
- The tool needs no global install, the same as the hooks.
- Claude can pass the id of an injected memory to `forget` with no search first.

### Negative

- The module API is early access. A Claude Code release can change it. The module tests pin the shapes used, and a refused registration writes one transcript line while the hooks keep working.
- The tool schema adds about 300 tokens to each session's prompt.
- Claude Code 2.1.294 and older are not supported.
- A user who kept the `omms-visible` prototype mod gets two tools and two sets of rows until they remove it.

### Neutral

- The tool appears only in a new session. `/reload-plugins` does not run `session.start` again.

## Alternatives Considered

| Option                                   | Rejected Because                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| An MCP server in the plugin              | A second process to start and keep alive. ADR-013 keeps the plugin free of one. |
| Keep the Bash route only                 | Each call shows as a shell command, and the user cannot see what OMMS found.    |
| Run `om-memory-system` from `PATH`       | A global install is optional and can be older than the copy the hooks run.      |
| A deferred tool behind tool search       | In the prototype, Claude skipped it and used the skill's Bash route.            |
| Pass any mode through                    | A model call could export a store to a file path.                               |
| Three entries under `modules`            | Claude Code loads one module path per plugin. A list of two loaded nothing.     |
| A separate retrieval for the recall rows | It would search twice and could show other memories than Claude received.       |

## References

- OpenSpec change: `openspec/changes/archive/2026-10-13-claude-code-visible-memory/`
- `hooks/omms.jsx`, `hooks/omms-memory-tool.jsx`, `hooks/omms-recall.jsx`, `hooks/omms-recall-parse.js`
- [Claude Code adapter: Memory tool and recall rows](../claude-code-adapter.md#memory-tool-and-recall-rows)
- [ADR-013](./013-claude-code-host-through-hooks-and-web-app.md), [ADR-016](./016-one-memory-skill-for-every-host.md), [ADR-019](./019-claude-code-status-line-through-a-plugin-module.md)
- [TDR-045](../tdr/045-claude-code-module-loading-and-tool-placement.md)
