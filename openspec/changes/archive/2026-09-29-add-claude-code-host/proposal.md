# Proposal

## Why

Claude Code sessions produce the same kind of decisions, fixes, and preferences that OMMS already captures from OpenCode and Pi, but none of it reaches the shared store. Claude Code has no in-process plugin API, so a third adapter needs a different shape: shell hooks and a warm worker instead of host events and a session model.

## What Changes

- Add a Claude Code host. The host value `claude-code` joins `opencode` and `pi` in provenance, the importer, backfill state, and the web API.
- Ship a Claude Code plugin from the repository: `.claude-plugin/plugin.json`, `hooks/hooks.json`, a marketplace file, and one skill. The hooks run a new `om-memory-system claude-hook <event>` command; the skill tells Claude how to use the new `memory` terminal command.
- Add `om-memory-system claude-hook <event>`. It reads the hook JSON from stdin, makes sure the OMMS web app is running (starting it on demand with the existing runtime rules), sends the event to it, and prints the hook output. It exits with code 0 on every failure so a broken OMMS never blocks Claude.
- Add three Claude Code hook behaviours:
  - `SessionStart` injects a short list of the project's recent memories as `additionalContext`, and re-injects the session's memories after compaction.
  - `UserPromptSubmit` injects the memories that match the prompt, using the shared retrieval section.
  - `Stop` (async) hands the turn to the web app, which reads only the new transcript entries and runs the shared capture pipeline. Failures use the capture retry queue.
- Add two web API endpoints for the hooks: one for retrieval and one for capture. Both need the existing API token. The capture endpoint queues work and returns at once.
- Live capture and profile learning for Claude Code use the external API only (`memoryModel`, `memoryApiUrl`, `memoryApiKey`). There is no host model and no session model for Claude Code, because hooks cannot call the session's model. When the external API is not fully configured, Claude Code capture is off and the missing settings are reported.
- Add `om-memory-system memory <search|add|list|forget|...>` so Claude Code, and the user, can run manual memory operations without an MCP server. Claude Code is the only host that uses it; OpenCode and Pi keep their `memory` tool.
- Add a Claude Code transcript reader in `src/importer/` for `~/.claude/projects/<slug>/<session>.jsonl`, and `om-memory-system import-claude-history` with the shared import options (`--root` for the location). The reader is pinned by fixture tests because the format is internal to Claude Code.
- Add a Claude Code automatic backfill, run by the web app after a Claude Code session starts, with the same pacing, lock, cutoff, and pause rules as the other hosts. Its model is always the external API.
- Show Claude Code on the web Settings page: backfill status and controls, import readiness, and the import source browser.
- Record an ADR for the hook-plus-worker shape and the external-API-only model rule for Claude Code.

## Capabilities

### New Capabilities

- `claude-code-adapter`: the Claude Code plugin, the `claude-hook` command, retrieval injection, live capture through `Stop`, the on-demand worker, the `memory` terminal command, and the skill.
- `claude-code-history-import`: the transcript reader, `import-claude-history`, the source kind, and the Claude Code backfill.

### Modified Capabilities

- `host-neutral-memory-core`: "Live capture uses one model rule on both hosts" gains the Claude Code rule (external API only, no host or session model). "History import has the same options on both hosts" covers three hosts, with `--root` as the Claude Code location flag.
- `auto-backfill`: "Past chats are imported automatically when a host starts" covers Claude Code, where the web app runs the backfill after a session start. "Each host's backfill model is configurable" states that Claude Code's backfill model is the external API.
- `web-autostart`: "The web app runs without a host session" states that a Claude Code hook may start the web app on demand, that it then serves the hook endpoints, and that a Claude Code session start counts as a host start for backfill.

## Impact

- New: `src/adapters/claude-code/` (hook client, transcript cursor, plugin assets), `src/importer/claude-conversation.ts`, `src/importer/claude-reader.ts`, `src/services/claude-hook-api.ts` (or the equivalent route handlers), `src/cli/` commands `claude-hook`, `memory`, `import-claude-history`, `.claude-plugin/`, `hooks/`, `skills/`.
- Changed: `src/types/index.ts` (`MemoryHost`), `src/importer/import-args.ts`, `import-sources.ts`, `run-import.ts`, `backfill-model.ts`, `backfill-controls.ts`, `src/services/backfill-state.ts`, `web-server.ts`, `api-handlers.ts`, `live-model-choice.ts`, `src/config.ts` (Claude Code backfill keys), `web/` Settings page, `package.json` `files`.
- Tests: new boundary test that `src/adapters/claude-code/` imports nothing from the other adapters and that core and services never import it; fixture tests for the transcript reader; hook command tests with a stub server; endpoint tests; the existing host-union tests extended to three hosts.
- Docs: `docs/claude-code-adapter.md`, `docs/claude-code-history-import.md`, `docs/cli.md`, `docs/configuration.md`, `docs/shared-core.md`, `README.md`, `docs/adr/013-*.md`, `CONTRIBUTING.md` if commands change.
- No new runtime dependency. The Claude Agent SDK is not used; the hooks call the installed `om-memory-system` binary.
- No change to OpenCode or Pi behaviour. Both keep their host model and session model options.
