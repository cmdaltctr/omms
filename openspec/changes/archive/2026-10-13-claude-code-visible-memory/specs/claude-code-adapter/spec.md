## ADDED Requirements

### Requirement: The plugin offers a memory tool to Claude

The OMMS plugin SHALL register a tool named `memory` from its module when a Claude Code session starts, so that Claude SHALL see it as `mcp__omms__memory`. The tool SHALL be in Claude's tool list from the first prompt, with no tool search needed. Its description SHALL say to search before debugging or investigating, and SHALL say to use the tool instead of running `om-memory-system memory` through Bash.

The tool SHALL take a `mode` and the options of that mode:

- `search`: `query`, `limit`, `scope`;
- `add`: `content`, `type`, `tags`;
- `list`: `limit`, `scope`;
- `profile`: `content`;
- `forget`: `id`;
- `help`.

The mode SHALL default to `search`. The tool SHALL run the matching `memory` operation through the plugin's launcher, with the same rule the hooks use, so it SHALL NOT need a global `om-memory-system` install. It SHALL run in the session's project directory. It SHALL return the operation's JSON to Claude unchanged.

The tool SHALL refuse a call without running anything:

- the modes `import`, `export`, `migrate` and `list-shards`, and any other mode not listed above;
- a `search` with no query;
- an `add` with no content;
- a `forget` with no id.

Each refusal SHALL return a short reason. The tool SHALL pass only a positive whole-number `limit` and a `scope` of `project` or `all-projects`, and SHALL drop any other value.

When the operation fails or prints `"success": false`, the tool SHALL return an error that names the reason. The reason SHALL be cut to 500 characters. The tool SHALL NOT handle any other tool's calls.

When the tool cannot be registered, the plugin SHALL write one line in the transcript that names the reason. The session SHALL continue.

#### Scenario: Claude searches memory

- **WHEN** the user asks how earlier work was handled, in a session with the plugin
- **THEN** Claude SHALL be able to call `mcp__omms__memory` with mode `search` and a query
- **AND** the call SHALL show as its own tool row, which the user can unfold to read the JSON result

#### Scenario: Widening to all projects

- **WHEN** Claude calls the tool with mode `search`, a query, and scope `all-projects`
- **THEN** OMMS SHALL search every project's memories

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, and the tool is called
- **THEN** the tool SHALL run OMMS through the plugin's launcher and return the result

#### Scenario: A refused mode

- **WHEN** Claude calls the tool with mode `import`
- **THEN** the tool SHALL return an error that lists the allowed modes
- **AND** no OMMS command SHALL run

#### Scenario: OMMS cannot run

- **WHEN** the launcher fails or exits with an error
- **THEN** Claude SHALL receive an error that starts with `memory failed:` and names the reason

#### Scenario: Other tools are untouched

- **WHEN** Claude calls `Read`, `Bash`, or any other tool
- **THEN** the plugin SHALL leave that call to Claude Code

### Requirement: Recalled memories show as fold rows in the reply

For each OMMS retrieval section that the hooks add to the main conversation, the plugin SHALL draw one row at the top of the next reply, above the reply text. A row SHALL be drawn only on the first block of a reply, and each section SHALL be shown on one reply only.

Collapsed, the row SHALL read `▸ ● memory [mode=<mode>, query="<query>", limit=<count>]`, where:

- `<mode>` is `search` for a prompt's recall and `recent` for a session's opening recall;
- `query` is the prompt on one line, cut to 60 characters, and is left out for `recent`;
- `<count>` is the number of memories in the section.

Pressing the row SHALL unfold it and pressing it again SHALL fold it. Unfolded, the row SHALL list:

- the mode;
- the query, cut to 300 characters;
- the count;
- each memory with its relevance, its id when the section has one, and a headline cut to 140 characters. The headline is the first line under a `## Request` heading, or else the first line.

A reply with no recall SHALL draw unchanged. Sections that a subagent receives, and hook context that is not an OMMS retrieval section, SHALL NOT make a row. The rows SHALL be drawn from the context the hooks already add, so showing them SHALL NOT run a second retrieval. The rows SHALL be shown only on the user's screen and SHALL NOT be sent to Claude.

#### Scenario: A prompt with matching memories

- **WHEN** the user sends "how did we handle om-pi-todo" and OMMS injects 3 memories
- **THEN** the reply SHALL start with `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]`

#### Scenario: Unfolding a row

- **WHEN** the user presses that row
- **THEN** it SHALL list `mode: search`, the query, `limit: 3`, and the three memories with relevance, id and headline
- **AND** pressing it again SHALL fold it

#### Scenario: First reply of a session

- **WHEN** OMMS injected recent memories at session start and the first prompt's recall also matched
- **THEN** the first reply SHALL show two rows, one with `mode=recent` and one with `mode=search`

#### Scenario: A reply with no recall

- **WHEN** no OMMS section was added since the last reply
- **THEN** the reply SHALL draw as Claude Code draws it, with no OMMS row

#### Scenario: A recall shows once

- **WHEN** one recall was shown on a reply and the next reply follows with no new recall
- **THEN** the next reply SHALL show no OMMS row

## MODIFIED Requirements

### Requirement: Claude Code integrates through hooks and a terminal command

The Claude Code integration SHALL be a Claude Code plugin made of hook definitions, one module, and one skill. Every hook SHALL run the plugin's launcher with Node.js and the `claude-hook <event>` arguments. The launcher SHALL run the newest valid local OMMS copy when that copy's version is the same as or newer than the plugin's version. When no local copy is that new, the launcher SHALL run `npx --yes om-memory-system@<plugin version>` with the same arguments and input. The plugin SHALL NOT need a global `om-memory-system` install. The plugin SHALL NOT register an MCP server. The `memory` tool that its module registers is a plugin tool and not an MCP server. The plugin SHALL NOT write to `CLAUDE.md`, and SHALL NOT read Claude Code's own model or login. The repository SHALL hold the plugin manifest, the hook file, the module files, the launcher, a marketplace file that points at the repository, and the skill. The documentation SHALL show the hook entries for users who add them to their Claude Code settings by hand. Hook entries that run the `om-memory-system` command directly SHALL keep working.

#### Scenario: Installing the plugin

- **WHEN** the user adds the OMMS marketplace and installs the plugin in Claude Code
- **THEN** the `SessionStart`, `UserPromptSubmit`, and `Stop` hooks SHALL be active in the next Claude Code session
- **AND** the `mcp__omms__memory` tool SHALL be in Claude's tool list
- **AND** no MCP server SHALL be listed for the plugin

#### Scenario: The plugin is newer than every local copy

- **WHEN** the plugin is 4.3.3, the newest local copy is the global 4.3.0, and `SessionStart` runs
- **THEN** the hook SHALL run OMMS 4.3.3 through `npx`
- **AND** that copy SHALL write itself into the newest-copy record

#### Scenario: A host copy is newer than the plugin

- **WHEN** the plugin is 4.3.3 and the record names a valid OpenCode 4.4.0 copy
- **THEN** the hook SHALL run the 4.4.0 copy and SHALL NOT run `npx`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH` and the record names a valid Pi copy at the plugin's version
- **THEN** the hooks SHALL run the Pi copy

#### Scenario: The command is not installed

- **WHEN** a hook runs, `om-memory-system` is not on the `PATH`, and no local copy is new enough
- **THEN** the launcher SHALL run the plugin's version through `npx`

#### Scenario: OMMS cannot run

- **WHEN** a hook runs and Node.js is missing, or no local copy is new enough and `npx` fails or runs out of time
- **THEN** Claude Code SHALL continue as if the hook returned nothing

#### Scenario: Hand-written hook entries

- **WHEN** the user's settings run `om-memory-system claude-hook session-start` directly
- **THEN** the hook SHALL still run, and the command SHALL hand off to the newest recorded copy

### Requirement: Manual memory operations run through a terminal command

`om-memory-system memory <operation> [options]` SHALL run the shared memory operations (search, add, list, forget, and the other modes the `memory` tool offers) against the current project, with host `claude-code`. It SHALL print the same result fields the `memory` tool returns, as JSON. The plugin's `memory` tool SHALL run this command for Claude. The plugin skill SHALL tell Claude Code to use the tool when it is in the tool list, and to run the command when it is not. Text inside `<private>` tags SHALL be stripped before storage, as in the tool.

#### Scenario: Claude saves a decision

- **WHEN** Claude Code runs `om-memory-system memory add --content "Use libSQL for the store" --type decision` in a project
- **THEN** the memory SHALL be stored for that project with host `claude-code`

#### Scenario: A search from the terminal

- **WHEN** the user runs `om-memory-system memory search "database choice"` in a project
- **THEN** the command SHALL print the matching memories with their ids and similarity, as JSON

#### Scenario: Claude saves through the tool

- **WHEN** Claude calls `mcp__omms__memory` with mode `add` and content in a project
- **THEN** the memory SHALL be stored for that project with host `claude-code`, the same as with the command

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.295 or later, and SHALL show one OMMS label in the prompt footer, at the right, after Claude Code's own mode labels. The label SHALL read `● omms: <state>`. The state SHALL be `connecting` from session start until the first health check answers, `connected` when the web app answers its health route, `web app off` when it does not, and `not installed` when the plugin's launcher reports that it can run no OMMS copy: no local copy is new enough and `npx` fails. The dot and state SHALL be green for `connected`, yellow for `connecting`, and red for `web app off` and `not installed`. The colours SHALL come from Claude Code's theme, so they follow the user's light or dark theme. The `connected` label SHALL NOT show a `⚠` sign or a yellow colour. The plugin SHALL NOT use Claude Code's plugin status row, which adds a `⚠` sign. A launcher run that only runs out of time SHALL NOT show `not installed`. The label SHALL then show the health state alone, with no update, and the plugin SHALL try again at its next check. The plugin SHALL get its facts through its own launcher, so the label SHALL NOT depend on a global `om-memory-system` install. The label SHALL update while the session runs. The label SHALL NOT hide or change Claude Code's own mode labels, and SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Session starts

- **WHEN** a Claude Code session starts and the first health check has not answered yet
- **THEN** the prompt footer SHALL show a yellow `● omms: connecting`

#### Scenario: Web app running

- **WHEN** a Claude Code session starts and the web app answers its health route
- **THEN** the prompt footer SHALL show a green `● omms: connected`
- **AND** the footer SHALL show no `⚠` sign and no yellow for OMMS
- **AND** no OMMS row SHALL show in Claude Code's plugin status row

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the prompt footer SHALL show a red `● omms: web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: Web app comes back during a session

- **WHEN** the label shows `web app off` and the web app starts answering its health route again
- **THEN** within 30 seconds the prompt footer SHALL show a green `● omms: connected`

#### Scenario: OMMS cannot run

- **WHEN** no local OMMS copy is at least the plugin's version and `npx` fails
- **THEN** the prompt footer SHALL show a red `● omms: not installed`

#### Scenario: A slow first download

- **WHEN** no local copy is new enough, `npx` is still downloading when the launcher run times out, and the web app answers its health route
- **THEN** the label SHALL read `● omms: connected` with no update
- **AND** the label SHALL NOT read `● omms: not installed`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, the newest-copy record names a valid Pi copy at the plugin's version, and the web app answers its health route
- **THEN** the label SHALL read `● omms: connected`

#### Scenario: Claude Code shows a mode label

- **WHEN** Claude Code shows its own mode label, for example `focus`, and the web app answers its health route
- **THEN** the prompt footer SHALL show the `focus` label and the `● omms: connected` label

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS label SHALL still show in the prompt footer
