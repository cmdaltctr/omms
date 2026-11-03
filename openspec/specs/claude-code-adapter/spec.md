# claude-code-adapter Specification

## Purpose

Defines the Claude Code host: a plugin of shell hooks and a skill that retrieves, captures, and manages shared memories through the OMMS web app, with no in-process plugin API and no MCP server.

## Requirements

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

### Requirement: Hooks never block Claude Code

The `claude-hook` command SHALL exit with code 0 on every failure, including a missing or unreadable hook input, an unreachable web app, an HTTP error, and a timeout. It SHALL stop reading standard input after a fixed time limit. `UserPromptSubmit` and `SessionStart` SHALL finish within their hook timeouts and SHALL return no context when the web app does not answer in time. `Stop` SHALL run asynchronously so capture never delays the next prompt. The command SHALL NOT write prompts or replies to its standard error or to the OMMS log.

#### Scenario: The web app is down and cannot start

- **WHEN** `UserPromptSubmit` runs while the web app is not running and the on-demand start fails
- **THEN** the hook SHALL exit with code 0 within its timeout
- **AND** the prompt SHALL reach Claude without added context
- **AND** the OMMS log SHALL record one metadata line with the event name and the failure code

#### Scenario: Standard input never closes

- **WHEN** the hook process receives no end of input
- **THEN** it SHALL stop waiting after the input time limit and exit with code 0

### Requirement: A hook starts the web app on demand

When a hook finds no OMMS web app on the configured port, it SHALL start one as a detached process with the same runtime, port, bind address, and token rules as the login item and `om-memory-system web`. It SHALL then wait for the web app to answer, up to the hook's time budget. The web app SHALL keep running after the Claude Code session ends. The hook SHALL follow the shared start rule for every host, so a hook and a host that start at the same time start at most one web app. When an OMMS web app already answers, the hook SHALL use it and SHALL NOT start a second server. Only `SessionStart` SHALL replace a running web app that is older than the newest recorded copy, under the shared start rule. `UserPromptSubmit` and `Stop` SHALL use any running OMMS web app, whatever its version.

#### Scenario: First hook of the day

- **WHEN** `SessionStart` runs and no OMMS web app is running
- **THEN** the hook SHALL start the web app in the background
- **AND** a later `UserPromptSubmit` in the same session SHALL get memories from that web app

#### Scenario: OpenCode already serves the web app

- **WHEN** an OpenCode start already started the shared web app and a Claude Code hook runs
- **THEN** the hook SHALL send its request to that web app and start nothing

#### Scenario: Pi already started the web app

- **WHEN** a Pi start already started the shared web app and a Claude Code hook runs
- **THEN** the hook SHALL send its request to that web app and start nothing

#### Scenario: Session start finds an older web app

- **WHEN** the web app runs 4.3.0, the record names a valid 4.3.3 copy, and `SessionStart` runs
- **THEN** the 4.3.0 web app SHALL step aside and a 4.3.3 web app SHALL serve the port

#### Scenario: A prompt finds an older web app

- **WHEN** the web app runs 4.3.0, the record names a valid 4.3.3 copy, and `UserPromptSubmit` runs
- **THEN** the hook SHALL send its request to the 4.3.0 web app and SHALL NOT replace it

### Requirement: Hook endpoints need the API token

The web app SHALL expose one retrieval endpoint and one capture endpoint for the hooks. Both SHALL require the same API token as the other `/api/` routes. The `claude-hook` command SHALL read the token the same way the web app creates it. A request without a valid token SHALL be rejected with the existing unauthorised response.

#### Scenario: A request without the token

- **WHEN** a process posts to the capture endpoint without the token
- **THEN** the web app SHALL reject it and SHALL NOT read the transcript

### Requirement: Memories are injected per prompt and restored after compaction

On `UserPromptSubmit` the hook SHALL return the shared retrieval section for the prompt, or nothing when no memory matches. On the first prompt of a session it SHALL also return the opening section when `openingContext` is on. On `SessionStart` with source `compact` or `resume`, and only when `compaction.enabled` is on, it SHALL return the session's own memories in the compaction format. With any other source it SHALL return no memories. Every text SHALL be wrapped in the retrieval tag.

#### Scenario: A prompt that matches saved memories

- **WHEN** the user submits a prompt about a topic with saved memories in that project
- **THEN** Claude SHALL receive those memories as added context for that prompt

#### Scenario: A fresh session adds nothing before the first prompt

- **WHEN** a Claude Code session starts with source `startup` in a project with saved memories, whatever `openingContext` says
- **THEN** the `SessionStart` hook SHALL return no added context
- **AND** the hook SHALL still start the web app when none is running

#### Scenario: Clearing the conversation adds nothing

- **WHEN** the user runs `/clear` and `SessionStart` runs with source `clear`
- **THEN** the hook SHALL return no added context

#### Scenario: The first prompt with the opening context off

- **WHEN** `openingContext` is off and the first prompt of a fresh session matches saved memories
- **THEN** Claude SHALL receive only the memories that match that prompt
- **AND** the project's most recent memories SHALL NOT be added unless they match the prompt

#### Scenario: The first prompt with the opening context on

- **WHEN** `openingContext` is on and the first prompt of a fresh session arrives
- **THEN** the answer SHALL hold the prompt's section and then the opening section for `openingContextQuery`

#### Scenario: A session resumes after compaction

- **WHEN** Claude Code compacts the session and `SessionStart` runs with the compaction source
- **THEN** the hook SHALL return the memories captured from that session
- **AND** an unrelated project's memories SHALL NOT be included

#### Scenario: A resumed session

- **WHEN** the user resumes a session and `SessionStart` runs with source `resume`
- **THEN** the hook SHALL return the memories captured from that session, in the compaction format

#### Scenario: Restore turned off

- **WHEN** `compaction.enabled` is `false` and `SessionStart` runs with source `compact` or `resume`
- **THEN** the hook SHALL return no added context

#### Scenario: Injected context is not captured as a memory

- **WHEN** a turn is captured whose prompt carried injected memories
- **THEN** the injected text SHALL NOT appear in the captured summary or in the stored prompt

#### Scenario: Injected context stays within the size limit

- **WHEN** a retrieval section is longer than Claude Code's added-context size limit
- **THEN** the hook SHALL cut it to the limit and keep the closing retrieval tag

### Requirement: Each Claude Code turn is captured through the shared pipeline

On `Stop`, the hook SHALL send the session id, the transcript path, the working directory, and the final assistant text to the capture endpoint. The web app SHALL read only the transcript entries after the last entry it captured for that session, SHALL build one work unit per user prompt from them with the shared transcript reader, and SHALL run each unit through the shared capture pipeline with host `claude-code`, source type `live-capture`, and the transcript entry ids as source entry ids. The endpoint SHALL queue the work and answer at once. It SHALL NOT read entries from sidechains, meta entries, or tool results as user prompts. Text inside `<private>` tags SHALL be removed before any storage. When the transcript is missing or its entries cannot be parsed, the endpoint SHALL log one metadata record and skip the turn, and the hook SHALL still exit with code 0.

#### Scenario: One turn, one memory

- **WHEN** the user asks Claude Code to fix a bug and Claude finishes the turn
- **THEN** the web app SHALL capture that exchange
- **AND** the memory SHALL carry host `claude-code`, the Claude session id, and the project directory

#### Scenario: A turn with several tool calls

- **WHEN** a turn holds many tool uses and tool results before the final text
- **THEN** the work unit SHALL hold the user prompt, the assistant text parts, and the tool calls with their inputs

#### Scenario: The same turn reported twice

- **WHEN** `Stop` fires twice for the same final assistant entry
- **THEN** the second request SHALL capture nothing new

#### Scenario: The transcript file lags behind

- **WHEN** the transcript file does not yet hold the final assistant entry when `Stop` fires
- **THEN** the work unit SHALL use the final assistant text sent by the hook for that turn

#### Scenario: A fully private prompt

- **WHEN** the whole user prompt is inside `<private>` tags
- **THEN** the turn SHALL be skipped and nothing from it SHALL be stored

### Requirement: Claude Code capture uses the external API only

Live capture and profile learning for Claude Code SHALL use the external API (`memoryModel`, `memoryApiUrl`, `memoryApiKey`). There SHALL be no Claude Code host model setting and no session model path. When the external API is not fully configured, Claude Code capture and profile learning SHALL be off, the missing settings SHALL be reported once per web app start in the log and on the Settings page, and retrieval SHALL keep working.

#### Scenario: The external API is set up

- **WHEN** `memoryModel`, `memoryApiUrl`, and `memoryApiKey` are set and a Claude Code turn ends
- **THEN** the capture SHALL call the external API

#### Scenario: The external API is half configured

- **WHEN** `memoryApiKey` is not set and a Claude Code turn ends
- **THEN** no model call SHALL be made
- **AND** the Settings page SHALL show that Claude Code capture is off and name the missing setting

### Requirement: Failed Claude Code captures use the retry queue

A retryable capture failure for a Claude Code turn SHALL follow the capture retry queue rules for cleaning, size limits, retention, and automatic retries. The web app SHALL run the Claude Code retry drain in the same way it runs the other hosts' drains.

#### Scenario: The external API times out

- **WHEN** the external API does not answer for a Claude Code turn
- **THEN** the cleaned turn SHALL be queued and retried later

### Requirement: Claude Code prompts feed profile learning

The web app SHALL record each captured Claude Code user prompt and SHALL run profile learning on the collected prompts at the same interval the other hosts use, with the external API. A failed profile step SHALL NOT block capture or manual memory operations.

#### Scenario: Enough prompts for a learning pass

- **WHEN** the number of new Claude Code prompts reaches the learning interval
- **THEN** the web app SHALL run one profile learning pass with the external API

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

### Requirement: The Claude Code adapter respects the layer boundaries

Code under `src/adapters/claude-code/` SHALL NOT import from the OpenCode or Pi adapters, and `src/core/`, `src/services/`, and `src/importer/` SHALL NOT import from it. The plugin bundle for the other hosts SHALL NOT grow to include the Claude Code hook client.

#### Scenario: The boundary test runs

- **WHEN** the boundary tests run
- **THEN** they SHALL fail on any import that crosses these boundaries

### Requirement: The capture endpoint reads only Claude Code transcripts

The capture endpoint SHALL accept a transcript path only when the path, after symlinks are resolved, is under the Claude projects folder and the file name is `<session-id>.jsonl`, where the session id is the one in the same request. The Claude projects folder SHALL be resolved as `<Claude folder>/projects`. The Claude folder is the `claudeConfigDir` setting when it is set, otherwise the `CLAUDE_CONFIG_DIR` environment variable of the web app, otherwise `~/.claude`. The endpoint SHALL compare paths by the letter case on disk. It SHALL answer any other path with `400` and SHALL NOT read the file.

#### Scenario: A transcript in the default folder

- **WHEN** `claudeConfigDir` is empty, `CLAUDE_CONFIG_DIR` is not set, and the hook sends `~/.claude/projects/<folder>/<session-id>.jsonl`
- **THEN** the endpoint SHALL queue the capture

#### Scenario: A transcript in the folder from the setting

- **WHEN** `claudeConfigDir` is `/data/claude` and the hook sends `/data/claude/projects/<folder>/<session-id>.jsonl`
- **THEN** the endpoint SHALL queue the capture, whatever `CLAUDE_CONFIG_DIR` says

#### Scenario: A path outside the folder

- **WHEN** the path is outside the projects folder, reaches it through a symlink, or has a file name other than `<session-id>.jsonl`
- **THEN** the endpoint SHALL answer `400`
- **AND** it SHALL NOT read the file

#### Scenario: The setting changes while the web app runs

- **WHEN** the user saves a new `claudeConfigDir` on the Settings page
- **THEN** the next capture request SHALL use the new folder without a restart

### Requirement: Claude Code shows OMMS status under the prompt

The OMMS plugin SHALL require Claude Code 2.1.295 or later, and SHALL show one OMMS label in the prompt footer, at the right, after Claude Code's own mode labels. The label SHALL read `omms: <glyph>`. The state SHALL be `connecting` from session start until the first health check answers, `connected` when the web app answers its health route, `web app off` when it does not, and `not installed` when the plugin's launcher reports that it can run no OMMS copy: no local copy is new enough and `npx` fails. The glyph SHALL be `⧖` for `connecting`, and `✔` for `connected`. For `web app off` and `not installed` the glyph SHALL be `✘`, followed by the state's words. Each glyph SHALL be a single-column text symbol, not a colour emoji, and the label SHALL show no `●` dot. The glyph and any state words SHALL be green for `connected`, yellow for `connecting`, and red for `web app off` and `not installed`. The colours SHALL come from Claude Code's theme, so they follow the user's light or dark theme. The `connected` label SHALL NOT show a `⚠` sign or a yellow colour. The plugin SHALL NOT use Claude Code's plugin status row, which adds a `⚠` sign. A launcher run that only runs out of time SHALL NOT show `not installed`. The label SHALL then show the health state alone, with no update, and the plugin SHALL try again at its next check. The plugin SHALL get its facts through its own launcher, so the label SHALL NOT depend on a global `om-memory-system` install. The label SHALL update while the session runs. The label SHALL NOT hide or change Claude Code's own mode labels, and SHALL NOT replace or change the user's own `statusLine` setting.

#### Scenario: Session starts

- **WHEN** a Claude Code session starts and the first health check has not answered yet
- **THEN** the prompt footer SHALL show a yellow `omms: ⧖`

#### Scenario: Web app running

- **WHEN** a Claude Code session starts and the web app answers its health route
- **THEN** the prompt footer SHALL show a green `omms: ✔`
- **AND** the footer SHALL show no `⚠` sign and no yellow for OMMS
- **AND** no OMMS row SHALL show in Claude Code's plugin status row

#### Scenario: Web app stopped during a session

- **WHEN** the web app stops answering its health route while a session runs
- **THEN** within 30 seconds the prompt footer SHALL show a red `omms: ✘ web app off`
- **AND** memory capture SHALL continue to use the command hooks as before

#### Scenario: Web app comes back during a session

- **WHEN** the label shows `web app off` and the web app starts answering its health route again
- **THEN** within 30 seconds the prompt footer SHALL show a green `omms: ✔`

#### Scenario: OMMS cannot run

- **WHEN** no local OMMS copy is at least the plugin's version and `npx` fails
- **THEN** the prompt footer SHALL show a red `omms: ✘ not installed`

#### Scenario: A slow first download

- **WHEN** no local copy is new enough, `npx` is still downloading when the launcher run times out, and the web app answers its health route
- **THEN** the label SHALL read `omms: ✔` with no update
- **AND** the label SHALL NOT read `omms: ✘ not installed`

#### Scenario: No global install

- **WHEN** `om-memory-system` is not on the `PATH`, the newest-copy record names a valid Pi copy at the plugin's version, and the web app answers its health route
- **THEN** the label SHALL read `omms: ✔`

#### Scenario: Claude Code shows a mode label

- **WHEN** Claude Code shows its own mode label, for example `focus`, and the web app answers its health route
- **THEN** the prompt footer SHALL show the `focus` label and the `omms: ✔` label

#### Scenario: User has a status line of their own

- **WHEN** the user's settings define a `statusLine` command
- **THEN** that status line SHALL still show, and the OMMS label SHALL still show in the prompt footer

### Requirement: Claude Code tells the user about a newer OMMS release

At session start and every 6 hours, the plugin SHALL compare the version of the OMMS copy that its launcher runs with the `latest` version on the npm registry. When npm's version is newer and is not a prerelease, the OMMS label SHALL add a dim `· <version> available` after the state. The suffix SHALL NOT change the colour of the glyph or the state words. The plugin SHALL also show one toast per session that names `claude plugin update omms@omms` and `/reload-plugins`. The check SHALL send no session content. `OMMS_DISABLE_UPDATE_CHECK=1` SHALL turn the check off. A failed check SHALL show no notice.

#### Scenario: A newer release exists

- **WHEN** the launcher runs OMMS 4.3.3 and npm `latest` is 4.4.0
- **THEN** the label SHALL read `omms: ✔ · 4.4.0 available`, with the glyph green
- **AND** one toast SHALL name `claude plugin update omms@omms`

#### Scenario: A host copy is already newer than the global install

- **WHEN** the global install is 4.3.0, the launcher runs an OpenCode 4.4.0 copy, and npm `latest` is 4.4.0
- **THEN** the label SHALL show no update

#### Scenario: Only a prerelease is newer

- **WHEN** npm `latest` is 4.4.0-next.1 and the launcher runs OMMS 4.3.3
- **THEN** the label SHALL show no update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK=1` is set
- **THEN** OMMS SHALL NOT contact the npm registry

#### Scenario: npm cannot be reached

- **WHEN** the npm registry does not answer
- **THEN** the label SHALL show no update and no toast SHALL appear

### Requirement: The Claude plugin updates itself when npm has a newer release

After the session-start hook has run, OMMS SHALL read the plugin version from `.claude-plugin/plugin.json` under `CLAUDE_PLUGIN_ROOT` and the npm `latest` version of `om-memory-system`. When npm has a newer release that is not a prerelease, OMMS SHALL start `claude plugin marketplace update omms` and then `claude plugin update omms@omms` in a detached process, and SHALL NOT wait for it. OMMS SHALL NOT start a second update for the same release within 30 minutes. When `OMMS_DISABLE_UPDATE_CHECK` is `1`, or `CLAUDE_PLUGIN_ROOT` is not set, OMMS SHALL NOT contact npm. A failure SHALL NOT change the hook's output or exit code. A started or failed start SHALL write one `Claude plugin self-update` log record with a code and the two versions.

#### Scenario: A release is approved before the session starts

- **WHEN** the plugin is 4.12.0 and npm `latest` is 4.13.0
- **THEN** a new session SHALL start the background plugin update
- **AND** the log SHALL hold a `Claude plugin self-update` record with code `started`

#### Scenario: The plugin is current

- **WHEN** the plugin and npm `latest` are both 4.13.0
- **THEN** OMMS SHALL NOT start an update

#### Scenario: Two sessions start close together

- **WHEN** a session started the update for 4.13.0 one minute ago and another session starts
- **THEN** the second session SHALL NOT start another update

#### Scenario: The check is turned off

- **WHEN** `OMMS_DISABLE_UPDATE_CHECK` is `1`
- **THEN** OMMS SHALL NOT contact npm and SHALL NOT start an update

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

For each OMMS retrieval section that the hooks add to the main conversation, the plugin SHALL draw one row at the top of the next reply, above the reply text. A row SHALL be drawn only on the first block of a reply, and each section SHALL be shown on one reply only. A reply with no recall SHALL draw unchanged. Other hook context SHALL NOT make a row. The rows SHALL come from the context the hooks already add, SHALL NOT run a second retrieval, and SHALL NOT be sent to Claude.

#### Scenario: A prompt with matching memories

- **WHEN** the user sends "how did we handle om-pi-todo" and OMMS injects 3 memories
- **THEN** the reply SHALL start with `▸ ● memory [mode=search, query="how did we handle om-pi-todo", limit=3]`

#### Scenario: Unfolding a row

- **WHEN** the user presses that row
- **THEN** it SHALL list `mode: search`, the query, `limit: 3`, and the three memories with relevance, id and headline
- **AND** pressing it again SHALL fold it

#### Scenario: First reply of a session

- **WHEN** a fresh session starts, `openingContext` is off, and the first prompt's recall matches 2 memories
- **THEN** the first reply SHALL show one row, with `mode=search` and that prompt as the query
- **AND** no row SHALL show `mode=recent`

#### Scenario: A reply with no recall

- **WHEN** no OMMS section was added since the last reply
- **THEN** the reply SHALL draw as Claude Code draws it, with no OMMS row

#### Scenario: A recall shows once

- **WHEN** one recall was shown on a reply and the next reply follows with no new recall
- **THEN** the next reply SHALL show no OMMS row

#### Scenario: Other hook context

- **WHEN** another plugin's hook adds context that holds no OMMS retrieval section
- **THEN** no OMMS row SHALL be drawn for it

### Requirement: A Claude Code fold row reads like a memory tool call

Collapsed, a row SHALL read `▸ ● memory [mode=<mode>, query="<query>", limit=<count>]`. The mode SHALL be `restore` for a restored-session section, `opening` for the opening section, and `search` for any other section. For `search` the query SHALL be the last prompt before the section, on one line, cut to 60 characters. For `opening` it SHALL be the configured query. It SHALL be left out for `restore` and when no prompt came first. The count SHALL be the number of memories.

#### Scenario: A restored session

- **WHEN** Claude Code compacts the session and OMMS restores 4 of the session's memories
- **THEN** the next reply SHALL start with `▸ ● memory [mode=restore, limit=4]`

#### Scenario: Compaction right after a prompt

- **WHEN** the user sends a prompt, Claude Code compacts before the reply, and OMMS adds a restored section and then the prompt's section
- **THEN** the reply SHALL show one `mode=restore` row with no query and one `mode=search` row with the prompt as the query

#### Scenario: A search section with no prompt before it

- **WHEN** a non-restored section without the opening marker arrives with no prompt since the last reply
- **THEN** the row SHALL read `▸ ● memory [mode=search, limit=<count>]`, with no query

#### Scenario: The opening section

- **WHEN** `openingContext` is on, the query is "project setup", and the first prompt adds 2 prompt memories and 3 opening memories
- **THEN** the first reply SHALL show a `mode=search` row with `limit=2` and then `▸ ● memory [mode=opening, query="project setup", limit=3]`

#### Scenario: The opening marker cannot end early

- **WHEN** the configured query holds `-->` or a double quote
- **THEN** the marker SHALL hold the query without those characters and the row SHALL still read `mode=opening`

### Requirement: Pressing a Claude Code row unfolds it

Pressing a row SHALL unfold it and pressing it again SHALL fold it. Unfolded, the row SHALL list the mode, the query cut to 300 characters when there is one, the count, and each memory with its relevance and id when the section has them, and a headline cut to 140 characters. The headline is the first line under a `## Request` heading, or else the first line. Fold state SHALL last for the Claude Code session only, and SHALL NOT be written to the transcript or sent to Claude.

#### Scenario: A long query

- **WHEN** the user unfolds a `mode=search` row whose prompt is 400 characters long
- **THEN** the unfolded query SHALL be cut to 300 characters

#### Scenario: A restored memory has no relevance

- **WHEN** the user unfolds a `mode=restore` row
- **THEN** each memory SHALL show its id and headline with no relevance

#### Scenario: No fold command

- **WHEN** the user looks for a command to fold the rows in Claude Code
- **THEN** the plugin SHALL offer no `/omms-recall` command, and pressing a row SHALL be the only way to fold or unfold it

#### Scenario: A new session

- **WHEN** the user unfolded a row, then exits Claude Code and starts a new session
- **THEN** no fold state from the earlier session SHALL apply to the new session's rows

### Requirement: The visibleRecall setting gates Claude Code rows

The plugin SHALL draw no recall row when the effective `visibleRecall` value for the session's folder is `false`. The value is `false` when the global configuration or the project configuration sets it to `false`. A project value SHALL NOT turn rows on. The default SHALL be on. A changed value SHALL apply from the next injected section, with no restart. Turning rows off SHALL NOT stop the memories from reaching Claude.

#### Scenario: Turned off globally

- **WHEN** `visibleRecall` is `false` in the global configuration and a prompt recalls 3 memories
- **THEN** Claude SHALL receive the 3 memories
- **AND** the reply SHALL show no OMMS row

#### Scenario: Turned off for a project

- **WHEN** the global value is `true`, the project configuration sets `visibleRecall` to `false`, and a prompt in that project recalls memories
- **THEN** the reply SHALL show no OMMS row

#### Scenario: A project cannot turn rows on

- **WHEN** the global value is `false` and the project configuration sets `visibleRecall` to `true`
- **THEN** the reply SHALL show no OMMS row

#### Scenario: Rows on by default

- **WHEN** no configuration sets `visibleRecall` or `openingContext`
- **THEN** recall rows SHALL be drawn
- **AND** a main-session prompt's added context SHALL be the same as before this setting applied to Claude Code

#### Scenario: Rows off after compaction

- **WHEN** `visibleRecall` is `false` and OMMS restores the session's memories after compaction
- **THEN** Claude SHALL receive the restored memories and the reply SHALL show no OMMS row

#### Scenario: Rows off for the opening section

- **WHEN** `visibleRecall` is `false` and `openingContext` is on
- **THEN** the opening section SHALL carry the rows-off marker and no opening marker, and no row SHALL be drawn for it

#### Scenario: A changed value applies without a restart

- **WHEN** the user sets `visibleRecall` to `false` in the global configuration during a session
- **THEN** the next prompt's recall SHALL show no OMMS row

#### Scenario: The off state stays within the budget

- **WHEN** `visibleRecall` is `false` and the retrieval section fills the retrieval budget
- **THEN** the added context SHALL hold one short marker line that carries no memory text
- **AND** the added context, marker included, SHALL stay within the retrieval budget and Claude Code's added-context size limit

### Requirement: Claude Code subagents get task memories through SubagentStart and draw no rows

The plugin SHALL register a `SubagentStart` hook. When `subagentMemory` is on, it SHALL return the retrieval section for the subagent's task prompt, read from the parent transcript, and nothing when no task prompt is found or no memory matches. Off, it SHALL return nothing. A subagent SHALL get no opening section. Every subagent section SHALL carry the rows-off marker, and no section in a subagent's conversation SHALL make a row. Subagent turns SHALL NOT be captured on their own.

#### Scenario: Claude runs a subagent with subagent memory on

- **WHEN** `subagentMemory` is on and a prompt makes Claude run an Agent tool subagent whose task matches saved memories
- **THEN** the subagent's transcript SHALL hold one OMMS retrieval section for that task
- **AND** the subagent's transcript view SHALL show no OMMS row

#### Scenario: Subagent memory off

- **WHEN** `subagentMemory` is `false` in the global or the project configuration
- **THEN** the `SubagentStart` hook SHALL return no added context

#### Scenario: No task prompt found

- **WHEN** the parent transcript holds no unanswered `Agent` or `Task` tool call for the subagent's type
- **THEN** the hook SHALL return no added context

#### Scenario: Parallel subagents of one type

- **WHEN** the parent transcript holds two unanswered `Agent` calls of the same type and two `SubagentStart` events follow
- **THEN** the first event SHALL search with the `prompt` of the older call and the second with the `prompt` of the newer call
- **AND** a third event with no new call SHALL return no added context

#### Scenario: A background subagent

- **WHEN** the parent transcript holds an `Agent` or `Task` call for the subagent's type whose only result is the "Async agent launched" receipt that Claude Code writes when it starts a background agent
- **THEN** the hook SHALL treat the call as unanswered and search with its `prompt`, once

#### Scenario: A section in a subagent's conversation

- **WHEN** hook context with an OMMS retrieval section is appended to a subagent's conversation
- **THEN** no OMMS row SHALL be drawn for it

#### Scenario: The main reply keeps its row

- **WHEN** the user's prompt recalls 2 memories and the reply runs a subagent
- **THEN** the main reply SHALL show one `mode=search` row with `limit=2`

#### Scenario: Registered hooks

- **WHEN** the plugin is installed
- **THEN** its hook file SHALL register `SessionStart`, `UserPromptSubmit`, `SubagentStart` and `Stop`, and no `SubagentStop` hook
