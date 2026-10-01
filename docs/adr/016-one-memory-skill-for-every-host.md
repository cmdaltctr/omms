# ADR-016: One memory skill for every host

**Date:** 2026-09-30
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

Agents did not search the memory store before they investigated a problem. In one Pi session, the agent investigated a fix again that OMMS had already stored.

- The memory context that OMMS adds to each session said only that it was "background information". It did not say that it holds only the closest matches, or that a full search exists.
- Only the Claude Code plugin had a skill, `skills/omms-memory/SKILL.md`. It told Claude to run `om-memory-system memory`. Pi and OpenCode had no OMMS skill.
- A user who added the Claude Code hooks by hand had to copy the skill folder by hand.
- The `memory` tool description in Pi and OpenCode did not tell the agent when to search.

A skill loads only when the agent chooses it. The injected context reaches every session.

## Decision

1. **One host-neutral skill.** `skills/omms-memory/SKILL.md` stays in the repository root, with the name `omms-memory`. It tells the agent to use the `memory` tool when the tool is in its tool list (Pi, OpenCode), and to run `om-memory-system memory` when it is not (Claude Code). It tells the agent to search before it debugs or investigates, when the user refers to earlier work ("we fixed this before", "last time", "remember", "did we"), and before a decision about project conventions.
2. **Each host loads the file with its own mechanism.** Nothing copies the file.
   - Claude Code: the plugin reads `skills/`, as before (`/omms:omms-memory`).
   - Pi: `package.json` lists `skills` in `files` and sets `pi.skills: ["./skills"]`. Pi reads it from the installed package (`/skill:omms-memory`).
   - OpenCode V1: the plugin's `config` hook adds the package's `skills` folder to `cfg.skills.paths`. The folder is resolved from the module URL. A missing folder is logged and skipped.
   - OpenCode V2: the adapter adds the skill through `ctx.skill.transform`.
3. **The injected header tells the agent to search.** `formatContextForPrompt` in `src/services/context.ts` is shared by every host. Its header now says that the memories are the closest matches only, and tells the agent to search the full store with the `memory` tool or the `omms-memory` skill before it investigates or when the user refers to earlier work. The header stays short, because it is sent on every turn.
4. **The tool text tells the agent to search.** The Pi and OpenCode `memory` tool description comes from one constant in `src/core/memory-tool-text.ts`. It says to search the store before debugging or investigating.

The name `omms-memory` does not change, so Claude Code users keep the command they know and need no alias.

## Consequences

### Positive

- One file holds the guidance for every host. A fix to the text reaches all three hosts.
- Pi and OpenCode get the skill with the package. The user does no manual step.
- The header reaches every session, also when the agent never loads the skill.
- The `memory` tool text and the header give the same instruction.

### Negative

- The skill, the header, and the tool text raise the chance of a search. They cannot force a model to search.
- The header is longer by one sentence on every turn.
- The skill text names both call paths, so each host reads one path it cannot use.

### Neutral

- The Claude Code plugin files are still not in the npm package. Claude Code users install the plugin from the repository.
- The user can still start the skill by name in each host.

## Alternatives Considered

| Option                                                       | Rejected Because                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Copy the skill into `~/.config/opencode/skills/` at start    | It writes into another tool's config folder and leaves stale copies after an uninstall.                    |
| A separate skill file for each host                          | Three copies of the same guidance drift apart.                                                             |
| Rename the skill for Pi and OpenCode                         | Claude Code users would lose the command they know, or need an alias.                                      |
| Change only the skill                                        | A skill loads only when the agent chooses it. The header reaches every session.                            |
| Put the full search instructions in the header on every turn | It adds many words to every turn. One sentence that points to the tool and the skill is enough.            |
| Search the store automatically before every agent turn       | OMMS already adds the closest matches. A second search would add cost and context without a known benefit. |

## References

- OpenSpec change `settings-keys-embedding-claude`
- `skills/omms-memory/SKILL.md`
- `src/services/context.ts`, `src/core/memory-tool-text.ts`
- `src/adapters/opencode/package-skills.ts`, `src/index.ts`, `src/v2/adapter.ts`, `package.json`
- `tests/claude-plugin-assets.test.ts`, `tests/package-skills.test.ts`, `tests/opencode-skills.test.ts`, `tests/memory-context-header.test.ts`, `tests/memory-tool-description.test.ts`
- ADR-013: Claude Code host through hooks and the web app
- [Using memory](../using-memory.md#the-omms-memory-skill)
