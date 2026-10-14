# TDR-045: Claude Code module loading and tool placement

**Date:** 2026-10-13
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** claude-code, plugin-module, memory-tool

## Context

A personal mod prototype, `~/.claude/mods/omms-visible`, added a `memory` tool and recall rows to Claude Code 2.1.296. The change `claude-code-visible-memory` moved it into the OMMS plugin ([ADR-026](../adr/026-claude-code-memory-tool-from-plugin-module.md)). The prototype and the move found four facts about how Claude Code loads modules and lists tools. None of them is in the Claude Code docs, and each one cost a restart or a failed test run to find.

### Root Cause Analysis (if debugging-driven)

1. **A mod folder did not load.** A folder in `~/.claude/mods` loads only when the `CLAUDE_CODE_PLUGIN_DIRS` setting lists it. A plugin's own `modules` entry in `hooks/hooks.json` needs no setting.
2. **`/reload-plugins` did not show the tool.** It reloads module code but does not run `session.start` again. A tool that is registered in `session.start` appears only in a new session.
3. **Claude used Bash and not the tool.** With the tool deferred behind tool search, Claude loaded the `omms-memory` skill and ran `om-memory-system memory` through Bash. After the change to `isDeferred: false` and a description that says "Use this tool instead of running `om-memory-system memory` through Bash", Claude called the tool in a fresh session: one project search, then one all-projects search, with no Skill or Bash call. The prototype session notes record both runs. The live check of the plugin (task 7.1, Claude Code 2.1.296) gave the same result: one `mcp__omms__memory` search call, with no Skill or Bash call.
4. **The module did not load after the split into three files.** `claude plugin test` reported `hooks module did not load` for each of these:
   - `on("session.start") is registered twice without a matcher`, with one hook in the status file and one in the tool file;
   - `the value of registerStatus(on) is kept`, when a register function returned a start function;
   - `$ is passed to "startMemoryTool", imported from "./omms-memory-tool.jsx": $ is followed only into a function declared in this same file, never across an import`;
   - `the state library's update takes a source the scan can read`, when the entry wrote an atom that another file declared.

   A `modules` list with two entries gave `no hooks module to load; hooks/hooks.json names none in "modules"`.

## Decision

- Test with the plugin itself, through `claude --plugin-dir <worktree>`, not through `CLAUDE_CODE_PLUGIN_DIRS`.
- After a change to tool registration, start a new session. Do not trust `/reload-plugins`.
- Register the tool with `isDeferred: false`, and say in its description that it replaces the Bash command.
- Keep one entry, `hooks/omms.jsx`, that owns the one `session.start` hook. Its start work lives in same-file functions. The other files export hook registrations, constants and pure helpers. The entry declares its own copy of the `{ plugin: "omms", key: "label" }` atom.

## Consequences

### Positive

- The tool shows from the first prompt, and Claude calls it.
- Each loader rule has a known error text, so the next split of the module is quick.

### Negative

- The status label's start code lives in `omms.jsx`, away from the label drawing in `omms-status.jsx`.
- The tool schema costs about 300 prompt tokens per session.

### Neutral

- The rules come from the loader's static scan. A later Claude Code release can relax or tighten them.

## Alternatives Considered

| Option                                          | Rejected Because                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| A deferred tool, with the skill naming it       | Claude still took the Bash route in the prototype.                  |
| One `session.start` hook in each module file    | The loader refuses a second hook with no matcher.                   |
| Pass `$` to start functions in other files      | The loader follows `$` only into functions of the same file.        |
| List each module file under `modules`           | A list of two entries loaded nothing.                               |
| Keep the status and tool start code in one part | Gives the status file a second job; the maintainer chose the entry. |

## How to Recognise / Handle This Again

1. A new tool is missing: start a new session, not `/reload-plugins`. Then check the transcript for `could not register the memory tool:`.
2. Claude runs `om-memory-system memory` through Bash with the plugin loaded: check that the tool is registered with `isDeferred: false`.
3. `claude plugin test` reports `hooks module did not load`: read the rule after the colon, and move the code it names into the file that owns the hook or the atom.
4. A mod under `~/.claude/mods` does nothing: add its folder to `CLAUDE_CODE_PLUGIN_DIRS`.

## Revisit Triggers

- A Claude Code release that allows a `session.start` hook per file, or `$` across imports.
- A Claude Code release that lists deferred plugin tools in the prompt.

## References

- OpenSpec change: `openspec/changes/archive/2026-10-13-claude-code-visible-memory/` (design.md Decisions 1 and 8)
- `hooks/omms.jsx`, `hooks/omms-memory-tool.jsx`, `scripts/test-claude-mod.sh`
- [ADR-026](../adr/026-claude-code-memory-tool-from-plugin-module.md), [TDR-025](./025-claude-plugin-test-runs-whole-folder.md)
