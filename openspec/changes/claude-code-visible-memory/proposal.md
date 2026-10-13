# Proposal

## Why

In Claude Code, OMMS works but the user cannot see it. Recall goes into hidden context, so the chat shows nothing. Claude Code also has no `memory` tool, so the model loads the skill and runs `om-memory-system memory` through Bash, which shows as "Ran 3 shell commands". In OpenCode, every memory search is a tool row that the user can unfold.

A personal mod prototype (`~/.claude/mods/omms-visible`) fixed both on Claude Code 2.1.296. In a fresh session the model called the new tool twice. It searched the project, then all projects. It used no Skill or Bash. Each call drew its own fold row, and the recall cards drew at the top of the reply. This change moves that prototype into the OMMS plugin, so every Claude Code user gets it with no settings change.

## What Changes

- **Memory tool:** the plugin registers a `memory` tool from its module. The model sees it as `mcp__omms__memory`.
  - It runs `memory <mode> ...` through the plugin's own launcher (`bin/omms-launch.mjs --at-least-own-version`), so it needs no global install, the same as the hooks.
  - It offers the modes `search`, `add`, `list`, `profile`, `forget` and `help`.
  - It refuses `import`, `export`, `migrate` and `list-shards`, because those move or rewrite whole stores.
  - It is listed in the prompt from the start, and its description says to use it instead of the Bash command.
- **Recall cards:** each recall OMMS injects gets one fold row at the top of the next reply.
  - Collapsed, the row reads `▸ ● memory [mode=search, query="…", limit=N]`.
  - Unfolded, it shows the mode, the query, the limit, and each result's relevance, id and one-line headline.
  - The cards read the context the hooks already inject, so recall does not run twice.
- **One module entry:** `hooks/hooks.json` names one module, `hooks/omms.jsx`. It registers the existing status label, the memory tool and the recall cards from separate files.
- **Memory ids:** injected memories carry their ids, `<memory id="mem_…" relevance="N%">`. This is the same for every host.
- **Skill:** the bundled `omms-memory` skill gets a "Using OMMS in Claude Code" section. It covers:
  - the recall rows;
  - calling `mcp__omms__memory` and not Bash;
  - the refused modes and running them in a terminal;
  - the Bash fallback for hand-written hooks or an older plugin;
  - memory ids for `forget`;
  - not saving the same turn twice, because capture already runs after each reply.

  The general "How to call OMMS" text names the Claude Code tool as well.
- **Docs and records:**
  - the Claude Code guide gets a section on the tool and the recall cards;
  - a new ADR records why Claude Code now gets a tool from a plugin module rather than an MCP server;
  - a new TDR records what the prototype taught. A mod in `~/.claude/mods` loads only when listed in `CLAUDE_CODE_PLUGIN_DIRS`. `/reload-plugins` does not rerun `session.start`. A tool behind ToolSearch lost to the skill's Bash route.
- Not in this change: a capture card after each reply. Capture runs in the background after the reply is drawn, so it needs its own design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-code-adapter`:
  - The plugin may register a plugin tool from its module, and still registers no MCP server.
  - New requirement: the plugin offers a `memory` tool that runs through the launcher.
  - New requirement: recall shows as fold rows in the reply.
  - Manual memory operations name the tool beside the terminal command.
- `omms-skill`:
  - the skill directs Claude Code to the `memory` tool when the plugin provides it, and to the command otherwise;
  - new requirement: the skill has a "Using OMMS in Claude Code" section.
- `host-neutral-memory-core`: injected memories carry their ids, the same in every host.

## Impact

- **Plugin files:**
  - `hooks/hooks.json` (module entry);
  - new `hooks/omms.jsx`, `hooks/omms-memory-tool.jsx`, `hooks/omms-recall.jsx`, `hooks/omms-recall-parse.js` and their tests;
  - `hooks/omms-status.jsx` exports its register function.
- **Shared core:**
  - `src/services/context.ts`: the memory id attribute;
  - `src/core/retrieval.ts`: the restored-session format stays as it is, and the cards parse it.
- **Tests:**
  - `tests/claude-plugin-assets.test.ts`;
  - a new Bun contract test that runs the cards' parser on real retrieval output;
  - `scripts/test-claude-mod.sh` copies every module file.
- **Docs and skill:**
  - `skills/omms-memory/SKILL.md`;
  - `docs/claude-code-adapter.md`;
  - `docs/using-memory.md`;
  - a new ADR-026 and the ADR index;
  - a new TDR-040 and the TDR index.
- **Claude Code version:** the minimum stays 2.1.287 if the module APIs used here exist there. Otherwise it rises. Task 1.1 checks this.
- **Users of the prototype mod:** after upgrading, remove `~/.claude/mods/omms-visible` from `CLAUDE_CODE_PLUGIN_DIRS`. Otherwise two `memory` tools and two sets of cards show.
