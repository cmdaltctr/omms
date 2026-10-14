## ADDED Requirements

### Requirement: The skill has a section on using OMMS in Claude Code

The `omms-memory` skill SHALL have one section titled "Using OMMS in Claude Code". The section SHALL say:

- Recall arrives as added context, which the user sees as `▸ ● memory [mode=…]` rows at the top of the reply. The context holds the closest matches only.
- Claude should call `mcp__omms__memory`, and should not run the command through Bash, when that tool is listed.
- The tool refuses the `import`, `export`, `migrate` and `list-shards` modes. The user runs those with the `om-memory-system memory` command in a terminal.
- With hand-written hooks or an older plugin, no `memory` tool is listed. Claude then runs `om-memory-system memory` through Bash.
- Each injected memory shows its id, which Claude can pass to `forget` when the user asks to remove that memory.
- Capture runs after each reply in the background. Claude should not save the same turn again unless it holds a decision, a fix, or a preference that the user asked to keep.

The section SHALL stay short, and SHALL hold no Pi or OpenCode instructions.

#### Scenario: Claude Code loads the skill

- **WHEN** Claude Code loads `omms:omms-memory`
- **THEN** the skill text SHALL contain the "Using OMMS in Claude Code" section with the tool name `mcp__omms__memory`, the refused modes, and the Bash fallback

#### Scenario: Pi loads the skill

- **WHEN** Pi loads the skill
- **THEN** the Claude Code section SHALL NOT change which tool Pi uses, because the general instructions still direct Pi to its own `memory` tool

## MODIFIED Requirements

### Requirement: The skill tells the agent when and how to search

The skill description SHALL name the triggers: before debugging or investigating a problem; when the user refers to earlier work ("we fixed this before", "last time", "remember", "did we"); and before a decision about project conventions. The instructions SHALL say to search the full store before investigating, with several keyword searches when the first finds nothing, and to widen to all projects when the project search finds nothing. They SHALL use the host's `memory` tool when it is in the tool list: the `memory` tool in Pi and OpenCode, and `mcp__omms__memory` in Claude Code with the OMMS plugin. They SHALL use the `om-memory-system memory` command only when no `memory` tool is listed. They SHALL say when to save a memory and SHALL forbid storing secrets.

#### Scenario: A host with the memory tool

- **WHEN** the skill loads in Pi or OpenCode
- **THEN** its instructions SHALL direct searches to the `memory` tool with mode `search`

#### Scenario: Claude Code with the OMMS plugin

- **WHEN** the skill loads in Claude Code and `mcp__omms__memory` is in the tool list
- **THEN** its instructions SHALL direct searches to that tool with mode `search`, not to Bash

#### Scenario: A host without the memory tool

- **WHEN** the skill loads in Claude Code with hand-written hooks and no `memory` tool
- **THEN** its instructions SHALL direct searches to `om-memory-system memory search`
