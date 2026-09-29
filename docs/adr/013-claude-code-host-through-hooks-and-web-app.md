# ADR-013: Claude Code host through hooks and the web app

**Date:** 2026-09-29
**Status:** Proposed
**Deciders:** OMMS maintainers

## Context

OMMS runs on OpenCode and Pi. Both hosts load OMMS in their own process. The
adapter gets lifecycle events, reads the session, and can call the session's
model.

Claude Code has no in-process plugin API. A plugin can give it three things:
shell hooks, MCP servers, and skills.

- A hook is a short process. It gets JSON on standard input and can return JSON on standard output.
- The memory engine needs a process that stays up. It holds libSQL, the embedding model, the capture retry drain, and the backfill.
- A hook cannot call the model of the Claude Code session, and it cannot read that session's model settings.

The OMMS web app is already a process that stays up. It runs inside OpenCode,
from the login item, or from `om-memory-system web`. It has port ownership
rules and an API token.

The user ruled out an MCP server.

## Decision

Claude Code joins as a third host with host value `claude-code`. The
integration is a plugin of shell hooks and one skill. The web app does the
memory work.

- The plugin files are in the repository root: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, and `skills/omms-memory/SKILL.md`.
- Each hook runs the installed command `om-memory-system claude-hook <event>`. The user installs `om-memory-system` globally.
- The hook client (`src/adapters/claude-code/`) loads no store and no model. It finds the web app, or starts `om-memory-system web` as a detached process. It sends one request with the API token and exits with code 0 on every failure.
- The web app serves `POST /api/claude/retrieve` and `POST /api/claude/capture`. The handlers are in `src/importer/claude-hook-api.ts`, because they use the transcript reader.
- `SessionStart` and `UserPromptSubmit` inject memories through the shared retrieval code. `Stop` runs asynchronously. The web app reads new transcript entries and runs the shared capture pipeline.
- One transcript reader in `src/importer/` serves live capture and the history import.
- The `om-memory-system memory <mode>` command gives Claude Code the manual memory operations. The skill tells Claude when to run it.

Claude Code capture and profile learning use the external API only
(`memoryModel`, `memoryApiUrl`, `memoryApiKey`).

- `resolveClaudeCodeLiveModel` in `src/services/ai/live-model-choice.ts` holds the rule.
- There is no Claude Code host model setting and no session model path.
- The Claude Code backfill always uses the external API. There is no `claudeBackfillModel` key.
- When the external API is not fully configured, capture and profile learning are off. The missing settings are logged and shown on the Settings page. Retrieval and the `memory` command keep working.
- The OpenCode and Pi model order does not change.

## Consequences

### Positive

- Claude Code sessions reach the same store as OpenCode and Pi, with the same retrieval, capture, retry queue, profile learning, and backfill.
- The plugin holds no code and no `node_modules`. One `om-memory-system` install serves the CLI, the login item, and the hooks.
- Only the web app loads libSQL and the embedding model. A hook costs one small process start.
- A broken or missing OMMS never blocks Claude Code.

### Negative

- Claude Code capture needs an external API that the user pays for. A user with only a Claude Code sign-in gets retrieval and manual memory, but no automatic capture.
- The hooks depend on the web app. The first hook of the day can wait some seconds for the web app to start.
- The transcript format is internal to Claude Code. A new Claude Code version can break the reader. Fixture transcripts pin the 2.1.284 format.
- The hook knows only the configured port. When another program holds that port and the web app moves to another port, the hook cannot find it.
- The plugin files are not in the npm package. Users install the plugin from the repository marketplace.

### Neutral

- A web app that a hook starts keeps running after the Claude Code session ends, like the login item.
- Uninstalling the plugin leaves `claude-code` memories in the store. The other hosts can still retrieve them.

## Alternatives considered

| Option                                                               | Rejected because                                                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An MCP server for memory tools and capture                           | The user ruled it out. It also adds a second long-running process next to the web app.                                                                                              |
| A cold CLI process for each hook, with no web app                    | Each prompt would open libSQL and load the embedding model. That is too slow for the 10 s `UserPromptSubmit` budget. The retry drain and the backfill need a process that stays up. |
| Hooks that run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js"`      | We could not confirm that Claude Code installs the dependencies of an npm-sourced plugin. OMMS needs libSQL and the embedding runtime.                                              |
| The Claude Agent SDK, to call Claude's own model for capture         | It is a 227 MB native binary. It would also use the user's Claude login for background work, which the plugin must not read.                                                        |
| A Claude Code host model, or the session model, like the other hosts | A hook cannot call the session's model, and Claude Code does not report its model settings to hooks. Only the external API works.                                                   |

## References

- [Claude Code adapter](../claude-code-adapter.md)
- [Claude Code history import](../claude-code-history-import.md)
- [ADR-006: One live-model rule for OpenCode and Pi](./006-one-live-model-rule-for-both-hosts.md)
- [ADR-011: Shared code never imports a host adapter](./011-shared-code-never-imports-adapters.md)
- [ADR-012: Keep cleaned failed turns for a limited time to retry capture](./012-capture-retry-queue-stores-cleaned-turns.md)
- `openspec/changes/add-claude-code-host/design.md`
