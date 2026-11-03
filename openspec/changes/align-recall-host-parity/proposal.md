# Proposal

## Why

The three hosts handle recall in different ways that nobody chose on purpose. Claude Code adds the project's recent memories before the user's first prompt, ignores the `visibleRecall` setting, and labels its rows `mode=recent` for two different things. OpenCode V2 and Pi add only the memories that match each prompt and honour `visibleRecall`. OpenCode V2 injects memories into subagent sessions, and Claude Code and Pi do not. Claude Code restores the session's memories after compaction and resume, OpenCode V2 after compaction only, and Pi never.

The user decided on 2026-11-03:

- Every host adds only what the prompt needs by default.
- "Injection at session start" is an option on all three hosts, off by default. When it is on, the first message of a new session also gets the memories that match a search query the user can edit.
- Subagent sessions get the memories that match their task, on by default, with a switch to turn it off.
- Memories restore after compaction and after resume on all three hosts.
- Claude Code honours `visibleRecall`.
- The differences that come from the hosts themselves are written down instead of changed.

## What Changes

- **BREAKING (Claude Code default):** `SessionStart` with source `startup` or `clear` adds no memories. The Claude Code default changes from "recent memories at session start" to "nothing beyond the per-prompt recall". `SessionStart` still starts the web app, the self-update check and the backfill.
- New global setting `openingContext` (boolean, default `false`). When it is `true`, the first prompt of a main session on OpenCode V2, Pi and Claude Code runs one extra search and adds the matching memories to that prompt's injected context. On every host it travels with the first model request: OpenCode V2 and Pi have no model request before the first prompt, and Claude Code uses its first `UserPromptSubmit` so that all three behave the same. A project config can turn it off, never on.
- New global setting `openingContextQuery` (text, trimmed, 500 characters at most, default `project architecture, setup, conventions and key decisions`). It is a search query, not fixed text. An empty query adds nothing. The extra search uses the same relevance filter, result limit and retrieval budget as the per-prompt recall.
- New global setting `subagentMemory` (boolean, default `true`). When it is on, a subagent session gets the memories that match its task prompt, with the per-prompt relevance filter and limits. OpenCode V2 gates its current child-session injection with it. Claude Code gets a new `SubagentStart` hook. Pi gets the gate on the OMMS side; the injection needs a separate change in om-pi-subagents to load OMMS in its children. A project config can turn it off, never on. Subagent sessions still draw no rows and follow the existing capture rules.
- Restore parity: after compaction and after resume, each host adds the session's own memories in the shared compaction format, only when the existing `compaction.enabled` is on (default `true`, unchanged), up to `compaction.memoryLimit`. One setting controls all three hosts. It becomes editable on the web Settings page; a project config can still turn it on or off, as today. Claude Code keeps its `SessionStart` `compact`/`resume` restore. OpenCode V2 adds a resume restore. Pi adds both, through `session_compact` and resume detection.
- Row labels: `mode=search` for a prompt's recall, `mode=opening` for the opening search (with the configured query), and `mode=restore` for a restored section, on all three hosts. Every row honours `visibleRecall`. Claude Code draws no `mode=recent` row after this change.
- Claude Code honours `visibleRecall`. When the effective value (global plus project) is `false`, `handleClaudeRetrieve` puts a short marker line right after each opening `<omms-retrieval>` tag. The module reads the marker and draws no row. With the defaults, a Claude Code main-session prompt's injected text is the same as today.
- The OMMS web app Memory page (`/memory`) gets a "Memory injection" section below the host cards and the "Import all hosts" row, not on the Settings page. The Shared view links to it. The section has a switch labelled "Inject memories at session start" with the note "added to the first message of a new session", the query text area, a "Subagent memory" switch, a "Restore memories after compaction or resume" switch with its memory limit, Save, reset to default, and a note that the options apply to OpenCode V2, Pi and Claude Code. The config file template and `docs/configuration.md` document all five settings.
- Documentation: the Claude Code Retrieval table, the `visibleRecall` section, new "Memory injection" sections, the `chatMessage` settings that now apply only to OpenCode V1, the recall-row and restore text in the three adapter guides, and one "Host differences" table with a "Why" column in `docs/using-memory.md`. README gets a two-line mention and a link. `CONTRIBUTING.md` gets parity wording that allows documented host differences.
- ADR-040 records why the opening context is optional, off by default, query-driven and delivered with the first prompt, why subagent memory is on by default, and which host differences stay.

### Non-goals

- OpenCode V1. It still adds recent memories to the first message (`chat.message` in `src/index.ts`) and ignores the new settings. The repository rule says OpenCode work is V2 only.
- The om-pi-subagents change that loads OMMS in Pi child sessions. It belongs to that repository (design, open question 1).
- Recall rows in subagent sessions, and any new capture path for subagent turns.
- A separate `openingContextMaxMemories` setting. The opening search reuses the per-prompt limits (design D1c).
- A `/omms-recall` command or an in-session import command on Claude Code. Fold state that survives a restart on Pi or Claude Code. These are host limits (see the design).
- The subagent claim edge case (score 4). It is a proposed issue in the design, not a task.
- Removing `recent` from the shared summary type in `src/core/recall-summary.ts`. OpenCode V1 is the only host that still makes a recent-memory opening recall.

## Capabilities

### New Capabilities

- `opening-context`: the `openingContext` and `openingContextQuery` settings, first-prompt delivery on OpenCode V2, Pi and Claude Code, the shared search and budget rules, and the `mode=opening` row.
- `subagent-memory`: the `subagentMemory` setting, per-host subagent injection, no rows in subagent sessions, unchanged capture rules.

### Modified Capabilities

- `claude-code-adapter`: the injection requirement drops the opening recent-memories list and adds the opening section on the first prompt. The fold-row requirement is split into smaller requirements, uses `mode=restore` and `mode=opening`, and gains the `visibleRecall` gate. A subagent requirement adds the `SubagentStart` hook and keeps rows out of subagent sessions.
- `opencode-v2-adapter`: the restore requirement covers resume as well as compaction.
- `opencode-visible-recall`: a summary can have mode `opening` (with its query) or `restore` (no query).
- `pi-agent-adapter`: Pi restores the session's memories after compaction and resume.
- `web-memory-hosts`: the Memory overview gains the Memory injection section below the host cards, and the Shared view links to it.

## Impact

Rough size: about 47 files across 9 task groups. One pull request, with the commit groups in design "Delivery order".

- Core and config (about 10 files): `src/utils/memory-limits.ts` (rule for `compaction.memoryLimit`), new `src/services/injection-options-config.ts`, `src/config.ts` (wiring only, no growth past its size-ceiling entry), new `src/core/opening-context.ts`, `src/core/retrieval.ts` (shared search step), `src/core/recall-summary.ts` (modes `opening` and `restore`), `src/config-template.ts`, `src/services/global-config-writer.ts`, `src/services/settings-snapshot.ts`, `src/services/visible-recall-config.ts` (doc comment).
- Claude Code (about 6 files): `src/importer/claude-hook-api.ts`, `src/adapters/claude-code/hook-client.ts` (`subagent-start` event), `hooks/hooks.json`, `hooks/omms-recall-parse.js`, `hooks/omms-recall.jsx`. If `claude-hook-api.ts` would pass its ceiling, the new subagent and first-prompt logic goes in a new `src/importer/claude-hook-context.ts`.
- OpenCode V2 (about 4 files): `src/v2/adapter.ts`, `src/v2/memory-bridge.ts`, `src/v2/recall-reporter.ts`, new `src/v2/session-parent.ts` (shared cached parent lookup). V1 (`src/index.ts`) does not change.
- Pi (about 2 files): `src/adapters/pi/extension.ts`, `src/adapters/pi/recall-rows.ts`. If `extension.ts` would pass 500 lines, the restore and first-prompt state go in a new `src/adapters/pi/session-context.ts`.
- Web (about 4 files): new `web/src/lib/components/memory/MemoryInjectionSection.tsx`, `web/src/lib/components/memory/MemoryOverview.tsx` (section below the "Import all hosts" row), `web/src/lib/components/memory/SharedView.tsx` (link row), `web/src/lib/i18n/settings.ts` (en, zh, ar). The Settings page does not change.
- Tests (about 20 files): new `tests/injection-options-config.test.ts` and `tests/opening-context.test.ts`; changes in `tests/recall-summary.test.ts`, `tests/global-config-writer.test.ts`, `tests/memory-limits-settings.test.ts`, `tests/web-settings-api.test.ts`, new `tests/web-memory-injection.test.ts`, `tests/memory-host-routes.test.ts`, `tests/web-settings-i18n.test.ts`, `tests/claude-hook-api.test.ts`, `tests/claude-injection-budget.test.ts`, `tests/claude-recall-parse-contract.test.ts`, `tests/claude-plugin-assets.test.ts`, `hooks/omms-recall.test.ts` (run by `scripts/test-claude-mod.sh`, which needs `claude` 2.1.295 or later), `tests/v2-plugin-adapter.test.ts`, `tests/v2-recall-reporting.test.ts`, `tests/v2-injection-budget.test.ts`, `tests/pi-extension.test.ts`, `tests/pi-recall-rows.test.ts`, `tests/pi-injection-budget.test.ts`.
- Docs (about 10 files): `docs/claude-code-adapter.md`, `docs/configuration.md`, `docs/using-memory.md`, `docs/opencode-adapter.md`, `docs/pi-adapter.md`, `README.md`, `CONTRIBUTING.md`, new `docs/adr/040-*.md` and its index row.
- No new dependency, no `package.json` change.
- Users who relied on the Claude Code opening list lose it by default. They get the same memories when a prompt matches them, can turn on "Inject memories at session start", or can ask Claude to search with the `memory` tool. Every subagent session gets extra context by default. The release note says both.
