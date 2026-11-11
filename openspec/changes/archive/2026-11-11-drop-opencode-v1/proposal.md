# Proposal: drop-opencode-v1

## Why

OMMS supports OpenCode V2 only, but the package still loads under OpenCode V1. The V2 plugin also runs through a V1 plugin object (`src/index.ts`) that it wraps as `legacy`, so V1 hooks, V1-only settings and V1 tests stay in the code. OpenCode documents that V1 hooks do not run in V2 and that each V1 hook has a native V2 replacement.

The OpenCode history importer has a related bug. It reads only the V1 tables `session`, `message` and `part`. OpenCode 2.x writes new sessions to `session_v2` and `session_message`. On the maintainer's database, 193 sessions created after 19 September 2026 are in `session_v2` only, so `/memory-import-opencode-history`, the terminal import and automatic backfill skip them with no warning.

## What Changes

- **BREAKING**: Remove the V1 `server` export from `src/plugin.ts` and the `./server` entry from `package.json`. OpenCode V1 can no longer load OMMS. OpenCode V2 loads the same default export as before.
- **BREAKING**: Delete the V1 plugin object (`OmmsPlugin` in `src/index.ts`). Move the work V2 still needs into V2 modules:
  - startup work (config, warm-up, models, backfill, web app, shutdown) runs from the V2 `setup`;
  - the `memory` and `skills` tools register through `ctx.tool.transform` with direct executors;
  - prompt-model recording runs in the V2 `context` hook;
  - idle capture, profile learning and the capture retry drain run from `ctx.event.subscribe()`;
  - clean-up runs from the function that `setup` returns.
- Delete V1-only code: the `config` hook (internal agent, command and skills path registration), `command.execute.before`, `chat.message`, the `session.compacted` restore, `resolveSessionAgent`, `buildRecentMemoriesSection`, and the V1 HTTP transport (`configureOpencodeHostTransport`, `opencode-host-config.ts`, the lazy `@opencode-ai/sdk` client).
- Port every user of the V1-shaped client facade (`src/v2/legacy-client.ts`) to the V2 plugin context, then delete the facade. Structured output calls `ctx.generate.text` once, with no internal session. Capture and profile learning read messages through `ctx.session.context`. The Settings model list reads `ctx.model.list`. See design, decision 6.
- Remove the `@opencode-ai/plugin` and `@opencode-ai/sdk` dependencies. No source file imports either after the port (see design, decision 8).
- **BREAKING**: Remove the settings `chatMessage.maxMemories`, `chatMessage.maxAgeDays` and `chatMessage.injectOn`. Only the V1 `chat.message` hook read them. OMMS ignores these keys in existing files, with no error and no warning. `chatMessage.enabled` and `chatMessage.excludeCurrentSession` stay, because every host reads them.
- Remove the `chatMessage.maxMemories` row from the web **Memory limits** card. The card shows five rows.
- Fix the OpenCode history importer. It reads the V2 tables, and it reads a V1 session only when `session_v2` has no row with the same id. Reruns match the import ledger by session id and user message id, so units imported from the V1 tables are not imported again.
- Update the docs, `AGENTS.md`, and the web text that names OpenCode V1. Add ADR 048 "OMMS supports OpenCode V2 only" and TDR 078 for the importer finding.
- release-please: the commit is `feat!:` with a `BREAKING CHANGE:` footer, so the next release is a major version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opencode-v2-adapter`: the package loads under V2 only; every OpenCode behaviour runs through native V2 APIs; the V1 compaction path and V1 agent rule are gone.
- `host-neutral-memory-core`: OpenCode V1 is no longer a compatibility surface.
- `memory-context-controls`: the `chatMessage.maxMemories` limit is gone; old `chatMessage` keys are ignored; the budget no longer covers a V1 recent-memory list.
- `web-settings`: the Memory limits card has five rows; the save and reset rules no longer name `chatMessage.maxMemories`; the OpenCode source check accepts a V2 database.
- `opencode-history-import`: the importer reads the V2 tables and matches the ledger by session and user message.
- `opening-context`: the OpenCode V1 scenario is gone.
- `memory-reranker`: the host list no longer names OpenCode V1.
- `omms-skill`: the OpenCode plugin loads the skill through V2 only.
- `skill-learning-capture`: the host list no longer names OpenCode V1.
- `web-memory-hosts`: the Memory injection host note no longer names OpenCode V1.

## Impact

- Code: `src/plugin.ts`, `src/index.ts` (deleted), `src/v2/plugin.ts`, `src/v2/adapter.ts`, new V2 modules for startup and session events, `src/adapters/opencode/` (memory and skills tools, package skills, opencode provider, auto-capture host, profile learning types), `src/core/retrieval.ts`, `src/config.ts`, `src/config-template.ts`, `src/utils/memory-limits.ts`, `src/services/settings-snapshot.ts`, `src/services/global-config-writer.ts`, `src/importer/opencode-reader.ts`, `src/importer/importer.ts`, `web/src/lib/memory-controls.ts`, web translations.
- Code (port): `src/v2/legacy-client.ts` and `src/adapters/opencode/in-process-client.ts` deleted; new `src/adapters/opencode/opencode-host.ts` and a V2 message mapper; about 60 lines change in `opencode-provider.ts`, `profile-model.ts`, `profile-llm-client.ts`, `profile-learning.ts`, `conversation.ts`, `auto-capture-host.ts`, `auto-capture-summary.ts`, `backfill-startup.ts`, `tui-recall.ts`, `import-command.ts`, `opencode-import-models.ts` and `src/importer/settings-models.ts`.
- Package: `package.json` `exports` loses `./server`; `dependencies` loses `@opencode-ai/plugin` and `@opencode-ai/sdk`. Run `bun run check:package`.
- Tests: about 20 test files change. Five V1-only test files are deleted. See tasks group 1.
- Users: an OpenCode V1 install stops loading OMMS after the upgrade. Old `chatMessage` keys stay in config files and do nothing. The next OpenCode import or backfill picks up the V2-only sessions.
- Docs: `docs/configuration.md`, `docs/opencode-history-import.md`, `docs/shared-core.md`, `docs/developers.md`, `docs/opencode-adapter.md`, `docs/web-ui-memory.md`, `README.md`, `AGENTS.md`, ADR 048, TDR 078.
