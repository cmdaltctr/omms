# Design

## Context

See proposal.md, Why. Claude Code exposes three things a plugin can use: shell hooks that get JSON on stdin and return JSON on stdout, MCP servers, and skills. The user has ruled out an MCP server. Hooks are short-lived processes, so the engine (libSQL, the embedding model, the retry drain, backfill) must live in a process that stays up. OMMS already has that process: the web app (`src/services/web-server.ts`), which runs inside OpenCode, from the login item, or from `om-memory-system web`, with port ownership rules and an API token.

Facts checked against Claude Code v2.1.284 docs and a real transcript on this machine:

- Hook input carries `session_id`, `transcript_path`, `cwd`, and `hook_event_name`. `SessionStart` adds `source` (`startup`, `resume`, `clear`, `compact`). `UserPromptSubmit` adds `prompt`. `Stop` adds `last_assistant_message` and `stop_hook_active`.
- A hook returns context with `{"hookSpecificOutput": {"hookEventName": "...", "additionalContext": "..."}}`. The string is capped at 10,000 characters. `UserPromptSubmit` defaults to a 30 s timeout; `async: true` is only for command hooks; `SessionEnd` gets 1.5 s, so it is not used.
- Transcript lines are JSON objects with `type` (`user`, `assistant`, `system`, `attachment`, `file-history-snapshot`, and others), `uuid`, `parentUuid`, `timestamp`, `cwd`, `sessionId`, `isMeta`, `isSidechain`, `version`, and `message` (`role`, `content` as a string or a list of `text`, `tool_use`, `tool_result`, `thinking` blocks). The docs say the format is internal and changes between versions.
- The hooks-lifecycle diagram groups the hooks as: per session `SessionStart`/`SessionEnd`, per turn `UserPromptSubmit`/`Stop`.

Constraints from `CLAUDE.md`: adapters stay thin, shared behaviour lives in `src/core/`, `src/services/`, or `src/importer/`, heavy modules load with dynamic `import()`, and secrets or prompts never reach the log.

## Goals / Non-Goals

**Goals:**

- Claude Code turns become memories through the same capture pipeline, retry queue, and profile learning as the other hosts.
- No hook ever blocks or breaks a Claude Code session.
- One transcript reader serves live capture, the terminal import, the web import, and the backfill.
- Everything Claude Code specific sits in `src/adapters/claude-code/`, one CLI command group, one route group, and the plugin files.

**Non-Goals:**

- Calling Claude's own model or login for any OMMS work.
- An MCP server, `CLAUDE.md` edits, or a `PreCompact` checkpoint.
- Using the Claude Agent SDK (227 MB native binary) for anything.
- Per-tool-call observations (`PostToolUse`). One turn is one work unit, as on the other hosts.

## Decisions

### 1. Hooks call the installed `om-memory-system` binary, not `${CLAUDE_PLUGIN_ROOT}`

The hook file uses the shell form `om-memory-system claude-hook <event>`. The plugin then has no code and no `node_modules`; it is just `hooks/hooks.json`, a skill, and the manifest. `docs/cli.md` already recommends a global install.

Alternative: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js"` with the npm package as the plugin source. Rejected because I could not confirm that Claude Code installs the package's dependencies for an npm-sourced plugin, and the package needs libSQL and the embedding runtime. A missing binary is handled: shell form fails, the hook returns nothing, Claude continues.

The plugin files live at the repository root (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `skills/omms-memory/SKILL.md`), because a plugin root must hold `.claude-plugin/plugin.json`. They are not added to the npm `files` list. The docs also show the same hook entries for a hand edit of `~/.claude/settings.json`.

### 2. The web app is the worker

The hook client posts to two new routes on the web app: `POST /api/claude/retrieve` and `POST /api/claude/capture`. Both sit behind the existing `isAuthorizedApiRequest` check, and the hook reads the token with `getOrCreateAuthToken()` (same user, same file). The routes are registered in `web-server.ts` next to `/api/search`, with the handlers in a new `src/importer/claude-hook-api.ts` so `web-server.ts` does not grow further.

When the hook finds no server (`GET /api/health` fails), it resolves the runtime with `resolveWebRuntime()` from `web-autostart.ts`, spawns `om-memory-system web` detached (`stdio: "ignore"`, `unref()`), and polls `/api/health` until the event's budget runs out. The existing port ownership and takeover rules apply because it is the same server code.

Alternative: run the CLI cold on each hook. Rejected: libSQL plus the embedding model cost seconds on every prompt.

### 3. Hook time budgets

| Event              | `hooks.json` timeout | Client budget                                 | Mode          |
| ------------------ | -------------------- | --------------------------------------------- | ------------- |
| `SessionStart`     | 20 s                 | start server up to 15 s, then one request 3 s | sync          |
| `UserPromptSubmit` | 10 s                 | start server up to 5 s, then one request 3 s  | sync          |
| `Stop`             | 60 s                 | start server up to 30 s, then one request 5 s | `async: true` |

The stdin read stops after 2 s. Every path ends with `process.exit(0)`. On failure the client logs one metadata line (event name, failure code, elapsed time) through the shared logger; never the prompt or reply.

### 4. Retrieval reuses the OpenCode injection logic

- `SessionStart` with source `startup` or `clear`: the same "recent project memories" list that OpenCode prepends on the first message (`src/index.ts` `chat.message` path), moved into a shared function in `src/core/retrieval.ts` so both hosts call it.
- `SessionStart` with source `compact` or `resume`: `formatMemoriesForCompaction()` over that session's memories (matched on `hostSessionId` and host `claude-code`).
- `UserPromptSubmit`: `buildRetrievalSection(prompt, cwd, session_id)` wrapped with `wrapRetrievalSection()`.

The client truncates the text at 9,500 characters before returning it, keeping the closing tag. The capture path strips the `RETRIEVAL_SECTION_TAG` block from prompts, as the other hosts do.

### 5. One transcript reader in `src/importer/`

`src/importer/claude-conversation.ts` holds pure functions: `parseClaudeTranscriptLine`, `extractClaudeConversationWindows(entries)`, and `claudeWindowToWorkUnit`. A window starts at a `user` entry with `isMeta` false, `isSidechain` false, and content that is a string or holds a `text` block and no `tool_result` block. It collects the following `assistant` entries' `text` blocks into `textResponses` and `tool_use` blocks into `toolCalls` (`{name, input}`), skips `thinking`, and stops at the next real user entry. `sourceEntryIds` holds the user uuid and every assistant uuid; `sourceTimestamp` is the user entry's timestamp; the project directory is the user entry's `cwd`.

`src/importer/claude-reader.ts` lists `~/.claude/projects/*/*.jsonl` (or `--root`), reads each file's first user entry for `cwd` and date, and loads units lazily, in the shape of `LazyImportSource` from `importer.ts`. It counts unparseable lines and unknown entry types and reports them like the Pi discovery does.

Fixtures: `tests/fixtures/claude-transcripts/` with a redacted real session (string prompt, text-block prompt, tool_use/tool_result pairs, thinking, a sidechain, a meta entry, an unknown type, one broken line). The tests assert exact window counts and contents.

### 6. Live capture uses a cursor table, not the ledger

The capture handler reads the transcript with the reader from decision 5, takes every window after the cursor for that session, and calls `captureConversation()` for each with `{host: "claude-code", hostSessionId: session_id, sourceType: "live-capture", sourceEntryIds, sourceTimestamp, projectDirectory: cwd}` and the external API `CaptureSummaryProvider` from `selectImportModel({})` (the same provider Pi uses for its external path). Failures go through `queueFailedCapture()` so the retry queue and drain work unchanged; `registerCaptureRetryDrain("claude-code", ...)` is called when the web app starts.

The cursor (`session_id`, last captured user entry uuid) lives in a small table in `user-prompts.db`, next to the retry queue, so a web app restart does not re-capture the last turn. With no cursor, the handler takes only the last window. When the last window's `textResponses` is empty or does not end with `last_assistant_message`, the handler appends that text, because the transcript file can lag the hook.

The handler pushes the work onto an in-process queue (one worker: a promise chain that runs the turns of every request in order, with the quick retries the other hosts use) and answers `202 {queued: true}` at once.

### 7. Profile learning and backfill run in the web app

- Each captured Claude Code prompt is recorded with the shared user-prompts store. When the count reaches `userProfileAnalysisInterval`, the handler runs the shared profile learning with the external API `ModelPort`, passed in directly. It does not call `registerHostProfileModel`, because that registration holds one model for the whole process and would replace OpenCode's model when the web app runs inside OpenCode.
- The first `SessionStart` that reaches the web app after it started calls `startAutoBackfill("claude-code")` through `backfill-controls.ts`, guarded by a process-level flag. The model resolver for `claude-code` always returns the external API selection, and `backfill-model.ts` has no config key for it. Pause, resume, lock, cutoff, and status reuse `backfill-state.ts` and `backfill-lock.ts` with the widened `BackfillHost` union.

### 8. Model rule

`live-model-choice.ts` gains `resolveClaudeCodeLiveModel(config)`: mode `manual` when the external API is fully configured, otherwise `disabled` with the missing keys. No new config keys. `getAutoCaptureProviderStatus` for OpenCode and Pi is untouched.

### 9. `memory` terminal command

`om-memory-system memory <mode> [--content ...] [--query ...] [--type ...] [--tags a,b] [--id ...] [--limit N] [--directory path]` parses flags into `MemoryOperationArgs` and calls `executeMemoryOperation(args, {directory, host: "claude-code"})`. Output is one JSON document on stdout. The skill `skills/omms-memory/SKILL.md` tells Claude to run `search` before answering questions about past decisions and `add` after a decision or fix. The command loads the engine with dynamic `import()` so `--help` stays fast.

### 10. Where code lives

| Path                                                      | Content                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/adapters/claude-code/hook-client.ts`                 | stdin read, server discovery and start, request, output, exit                                                                                                |
| `src/adapters/claude-code/hook-command.ts`                | `claude-hook <event>` entry used by the CLI                                                                                                                  |
| `src/importer/claude-hook-api.ts`                         | route handlers, capture queue, backfill trigger (in `src/importer/` because it uses the transcript reader; `web-server.ts` loads it with dynamic `import()`) |
| `src/services/claude-capture-cursor.ts`                   | cursor table in `user-prompts.db`                                                                                                                            |
| `src/importer/claude-conversation.ts`, `claude-reader.ts` | transcript parsing and discovery                                                                                                                             |
| `src/cli/index.ts`                                        | `claude-hook`, `memory`, `import-claude-history`                                                                                                             |
| `.claude-plugin/`, `hooks/`, `skills/`                    | plugin assets                                                                                                                                                |

`tests/claude-code-adapter-boundary.test.ts` mirrors `pi-adapter-boundary.test.ts`. `tests/plugin-bundle-boundary.test.ts` gains a check that the OpenCode bundle does not contain `adapters/claude-code`.

### 11. Web UI

The Settings page shows a Claude Code card in the backfill section (status, Run now, Pause, Resume), a Claude Code entry in import readiness, and a Claude Code source in the import form with the folder browser. Strings go through the existing i18n table with Chinese and Arabic text. Host labels come from one `hostLabel()` helper replacing the scattered `host === "pi" ? "Pi" : "OpenCode"` ternaries in `run-import.ts`, `backfill-controls.ts`, and `external-backfill-models.ts`.

### 12. Logging and privacy

The hook client and the handlers log only event names, session ids, counts, byte sizes, codes, and durations. Transcript text is read into memory, cleaned with `stripPrivateContent`, and never written anywhere except the capture trace under the existing `captureTrace` rules and the retry queue under ADR-012 rules.

## Risks / Trade-offs

- [Claude Code changes the transcript format] → Fixtures pin the current shape; unknown entry types and unparseable lines are skipped and counted; `last_assistant_message` from the hook keeps the final text even when parsing fails; the docs name the Claude Code version the reader was written against.
- [The web app is not running and takes long to start] → `SessionStart` has a 20 s budget and starts it once; the next prompts find it warm. A first prompt within those seconds gets no context, which is the same as today.
- [Two hook processes both try to start the web app] → The existing port ownership rules make the second one exit; the client polls health rather than owning the port.
- [Hooks run on every prompt and cost a process start each] → The client is a small CLI path that loads no engine modules; only the web app loads libSQL and the embedding model.
- [`Stop` fires twice for one turn, or after a hook-driven continuation] → The cursor table and `sourceEntryIds` make the second request a no-op; `stop_hook_active` is passed through and logged.
- [The external API is not configured] → Retrieval and the `memory` command keep working; capture logs a disabled status once per web app start; the Settings page shows the missing key.
- [Windows shell form] → `om-memory-system.cmd` resolves through the shell; the docs say to install globally with npm or bun so the shim exists.
- [Users who already run the login web app] → Nothing changes for them; the hooks find the running server.

## Migration Plan

1. Ship the code and the plugin files in one release. Existing OpenCode and Pi users see no change.
2. A Claude Code user installs `om-memory-system` globally, sets the external API keys in the global config, adds the marketplace, and installs the plugin (or pastes the hooks block).
3. Rollback: uninstall the plugin or remove the hooks block. Memories captured with host `claude-code` stay in the store and are valid for the other hosts.

## Open Questions

None that change the specs or tasks. The name of the ADR file (`013-claude-code-host-through-hooks-and-web-app.md`) and the exact Chinese and Arabic strings are decided during implementation.
