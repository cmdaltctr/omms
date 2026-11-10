# Tasks

## 1. Checks before building

- [ ] 1.1 Find whether the Claude Code mod `tool.call` context (`$` or the event) exposes the session ID; record the answer in design.md under "Session ID per host" and verify by quoting the API source or a live probe in a scratch HOME
- [ ] 1.2 Confirm the OpenCode V2 tool context carries the session ID that `src/v2/adapter.ts` can pass to the V1 executor; record the field name in design.md

## 2. Store: marker and kind filter

- [ ] 2.1 Write failing tests in `tests/memorisation-kind-filter.test.ts` that store one normal memory and one `type = "memorisation"` record, then check vector search, keyword search, exact scan, `listMemories`, `getMemoriesBySessionID` and the linked-space readers return only the normal one by default and only the memorisation with `kind: "memorisation"`; verify they fail on current code
- [ ] 2.2 Add the `kind` option with default `"normal"` to `vector-search.ts`, `keyword-search.ts`, `exact-scan.ts`, `linked-search.ts` and `client.ts`, putting the predicate in SQL; verify 2.1 passes
- [ ] 2.3 Add a test that a row with `type` NULL still appears in normal results; verify it passes
- [ ] 2.4 Add a test that greps `src/services` for SQL that reads `memories` and fails when a builder lacks the kind predicate; prove it fails by removing one predicate

## 3. Maintenance skips memorisations

- [ ] 3.1 Write failing tests that duplicate removal keeps two identical memorisations, retention cleanup keeps an old memorisation, AI tag backfill skips memorisations, and capture context ignores the latest memorisation; verify they fail
- [ ] 3.2 Add the predicate to `deduplication-service.ts`, `cleanup-service.ts`, the backfill query in `api-handlers.ts` and `getLatestProjectMemory` in `src/core/capture.ts`; verify 3.1 passes

## 4. Core memorise and recall

- [ ] 4.1 Write failing unit tests for `src/core/memorisation.ts`: ID format and clash retry, snapshot text with empty fields left out, the cap check and message in characters and in estimated tokens, `mz-` ID detection, and the one-strong-match rule (80 points, 10-point lead) versus up to three or `limit`
- [ ] 4.2 Implement `src/core/memorisation.ts` as pure functions with `CONFIG` passed in; verify 4.1 passes and the file stays under 500 lines
- [ ] 4.3 Write failing tests in `tests/memory-operations-memorise.test.ts` for modes `memorise` (explicit, snapshot, `memorize` alias, private content, caller tags plus `memorisation`, missing input) and `recall` (exact ID, unknown ID, text search returning memorisations only, nothing matched)
- [ ] 4.4 Add `memorise`, `memorize` and `recall` to `memory-operations.ts` (mode union, args, help list, embedding list) and `memory-tool-text.ts`; verify 4.3 and `tests/memory-tool-description.test.ts` pass
- [ ] 4.5 Write failing tests for `memorisationRepeat`: replace deletes the earlier snapshot of the same `hostSessionId` and keeps its ID; add keeps both; replace with no session ID adds and says so; explicit memorisations never replace
- [ ] 4.6 Add `memorisationRepeat` (default `"add"`) to `src/config.ts`, `config-template.ts`, `global-config-writer.ts` (allowlist and validator) and `settings-snapshot.ts`, and implement replace; verify 4.5, `tests/config.test.ts` and `tests/global-config-writer.test.ts` pass
- [ ] 4.7 Write failing tests for `memorisationMaxSize` and `memorisationSizeUnit`: defaults 2000 and `characters`, range 100 to 20,000 characters and 25 to 5,000 tokens checked as a pair, refused edits keep the previous value, and `memorise` uses the configured cap; add both keys to the same four config files and verify the tests pass
- [ ] 4.8 Document memorise, recall, the size cap settings and `memorisationRepeat` in `docs/using-memory.md` and `docs/configuration.md`; verify with Prettier

## 5. Hosts and CLI

- [ ] 5.1 Write failing tests that the OpenCode V2 schema, the V1 executor enum, Pi's `MEMORY_TOOL_MODES` and TypeBox params, and the Claude Code `MODES` list all accept `memorise`, `memorize` and `recall` with the snapshot fields; extend `tests/memory-space-tool-parity.test.ts`
- [ ] 5.2 Add the modes and fields to `src/v2/adapter.ts`, `src/index.ts` (and pass the V2 session ID per task 1.2), and `src/adapters/pi/extension.ts`; verify 5.1 passes for those hosts
- [ ] 5.3 Add the modes, fields and `--session-id` (per task 1.1) to `hooks/omms-memory-tool.jsx`, update `hooks/omms-memory-tool.test.ts`, and verify with `bash scripts/test-claude-mod.sh`
- [ ] 5.4 Write failing CLI tests for `om-memory-system memory memorise "<text>"`, `--topic/--done/--doing/--next`, `--session-id`, `memorize`, and `recall <id|text>` as a positional; add them to `src/cli/memory-command.ts` and verify they pass
- [ ] 5.5 Document the CLI modes and flags in `docs/cli.md`; verify with Prettier

## 6. Skills

- [ ] 6.1 Write `skills/omms-remember/SKILL.md` adapted from `s-handoff` per design.md (snapshot from context, no history files, under the cap, save with `memorise`, report the ID, `recall` triggers, no secrets)
- [ ] 6.2 Add the `recall` trigger text to `skills/omms-memory/SKILL.md` and the new modes to its mode table
- [ ] 6.3 Register the new skill for OpenCode in `src/adapters/opencode/package-skills.ts` if it lists skills by name; extend `tests/package-skills.test.ts` and `tests/claude-plugin-assets.test.ts` to expect `omms-remember`; verify they fail first, then pass
- [ ] 6.4 Document `/omms-remember` per host in `docs/using-memory.md`, `docs/claude-code-adapter.md`, `docs/pi-adapter.md` and `docs/opencode-adapter.md`; verify with Prettier

## 7. Web Memorisation page

- [ ] 7.1 Write failing API tests for `GET /api/memorisations` (current project, active and linked spaces, newest first, memorisations only) and `GET /api/memorisations/recall?q=` (ID and text); add the routes to `web-server.ts` and verify they pass
- [ ] 7.2 Add the `memorisation` view to `web/src/lib/routes.ts`, `MAIN_NAV` after `project`, `AppSidebar.tsx` labels and `App.tsx`; verify direct load and reload of `/memorisation` in a route test
- [ ] 7.3 Build the page (list, row detail, recall search with scores, Copy ID, Delete with confirmation, empty state, repeat choice and size cap box with Characters or Tokens choice, both saving through `PATCH /api/settings` and showing the range on a refused value) using the `omms-design` skill; keep each file under 500 lines
- [ ] 7.4 Add every new string in en, zh and ar to `web/src/lib/i18n/translations.ts` with British English; verify `tests/web-translations-parity.test.ts` passes
- [ ] 7.5 Check the page in the browser at desktop and 390px width in a scratch HOME on a free port, in English and Arabic; save screenshots to the scratchpad
- [ ] 7.6 Document the page in `docs/web-ui-memory.md` and add any new guide to `docs/README.md`; verify with Prettier

## 8. Integration

- [ ] 8.1 Live check in a scratch HOME with its own port and store: in Claude Code, run `/omms:omms-remember`, then in a new session ask "what were we gonna do with <topic>" and confirm the agent calls `recall`, gets the `mz-` record, and that the record never appears in per-prompt recall rows
- [ ] 8.2 Run `bun run ci:local` in the worktree and confirm it exits 0
- [ ] 8.3 Run `graphify update .`

## Workflow follow-up

- Run `openspec-verify-change`, then archive the change before opening the pull request.
- Open one pull request to `main`; merge only on the user's word.
