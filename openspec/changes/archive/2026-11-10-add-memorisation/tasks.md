# Tasks

## 1. Checks before building

- [x] 1.1 Find whether the Claude Code mod `tool.call` context (`$` or the event) exposes the session ID; record the answer in design.md under "Session ID per host" and verify by quoting the API source or a live probe in a scratch HOME
- [x] 1.2 Confirm the OpenCode V2 tool context carries the session ID that `src/v2/adapter.ts` can pass to the V1 executor; record the field name in design.md

## 2. Store: marker and kind filter

- [x] 2.1 Write failing tests in `tests/memorisation-kind-filter.test.ts` that store one normal memory and one `type = "memorisation"` record, then check vector search, keyword search, exact scan, `listMemories`, `getMemoriesBySessionID` and the linked-space readers return only the normal one by default and only the memorisation with `kind: "memorisation"`; verify they fail on current code
- [x] 2.2 Add the `kind` option with default `"normal"` to `vector-search.ts`, `keyword-search.ts`, `exact-scan.ts`, `linked-search.ts` and `client.ts`, putting the predicate in SQL; verify 2.1 passes
- [x] 2.3 Add a test that a row with `type` NULL still appears in normal results; verify it passes
- [x] 2.4 Add a test that greps `src/services` for SQL that reads `memories` and fails when a builder lacks the kind predicate; prove it fails by removing one predicate

## 3. Maintenance skips memorisations

- [x] 3.1 Write failing tests that duplicate removal keeps two identical memorisations, retention cleanup keeps an old memorisation, AI tag backfill skips memorisations, and capture context ignores the latest memorisation; verify they fail
- [x] 3.2 Add the predicate to `deduplication-service.ts`, `cleanup-service.ts`, the backfill query in `api-handlers.ts` and `getLatestProjectMemory` in `src/core/capture.ts`; verify 3.1 passes

## 4. Core memorise and recall

- [x] 4.1 Write failing unit tests for `src/core/memorisation.ts`: ID format and clash retry, snapshot text with empty fields left out, the cap check and message in characters and in estimated tokens, `ms-` ID detection, and the one-strong-match rule (80 points, 10-point lead) versus three by default or up to `limit` when one is given, above or below three
- [x] 4.2 Implement `src/core/memorisation.ts` as pure functions with `CONFIG` passed in; verify 4.1 passes and the file stays under 500 lines
- [x] 4.3 Write failing tests in `tests/memory-operations-memorise.test.ts` for modes `memorise` (explicit, snapshot, `memorize` alias, private content, caller tags plus `memorisation`, missing input) and `recall` (exact ID, unknown ID, text search returning memorisations only, nothing matched)
- [x] 4.4 Add `memorise`, `memorize` and `recall` to `memory-operations.ts` (mode union, args, help list, embedding list) and `memory-tool-text.ts`; verify 4.3 and `tests/memory-tool-description.test.ts` pass
- [x] 4.5 Write failing tests for `memorisationRepeat`: replace deletes the earlier snapshot of the same `hostSessionId` and keeps its ID; add keeps both; replace with no session ID adds and says so; explicit memorisations never replace
- [x] 4.6 Add `memorisationRepeat` (default `"add"`) to `src/config.ts`, `config-template.ts`, `global-config-writer.ts` (allowlist and validator) and `settings-snapshot.ts`, and implement replace; verify 4.5, `tests/config.test.ts` and `tests/global-config-writer.test.ts` pass
- [x] 4.7 Write failing tests for `memorisationMaxSize` and `memorisationSizeUnit`: defaults 2000 and `characters`, range 100 to 20,000 characters and 25 to 5,000 tokens checked as a pair, refused edits keep the previous value, and `memorise` uses the configured cap; add both keys to the same four config files and verify the tests pass
- [x] 4.8 Document memorise, recall, the size cap settings and `memorisationRepeat` in `docs/using-memory.md` and `docs/configuration.md`; verify with Prettier

## 5. Hosts and CLI

- [x] 5.1 Write failing tests that the OpenCode V2 schema, the V1 executor enum, Pi's `MEMORY_TOOL_MODES` and TypeBox params, and the Claude Code `MODES` list all accept `memorise`, `memorize` and `recall` with the snapshot fields; extend `tests/memory-space-tool-parity.test.ts`
- [x] 5.2 Add the modes and fields to `src/v2/adapter.ts`, `src/index.ts` (and pass the V2 session ID per task 1.2), and `src/adapters/pi/extension.ts`; verify 5.1 passes for those hosts
- [x] 5.3 Add the modes, fields and `--session-id` (per task 1.1) to `hooks/omms-memory-tool.jsx`, update `hooks/omms-memory-tool.test.ts`, and verify with `bash scripts/test-claude-mod.sh`
- [x] 5.4 Write failing CLI tests for `om-memory-system memory memorise "<text>"`, `--topic/--done/--doing/--next`, `--session-id`, `memorize`, and `recall <id|text>` as a positional; add them to `src/cli/memory-command.ts` and verify they pass
- [x] 5.5 Document the CLI modes and flags in `docs/cli.md`; verify with Prettier

## 6. Skills

- [x] 6.1 Write `skills/omms-remember/SKILL.md` adapted from `s-handoff` per design.md (snapshot from context, no history files, under the cap, save with `memorise`, report the ID, `recall` triggers, no secrets)
- [x] 6.2 Add the `recall` trigger text to `skills/omms-memory/SKILL.md` and the new modes to its mode table
- [x] 6.3 Register the new skill for OpenCode in `src/adapters/opencode/package-skills.ts` if it lists skills by name; extend `tests/package-skills.test.ts` and `tests/claude-plugin-assets.test.ts` to expect `omms-remember`; verify they fail first, then pass
- [x] 6.4 Document `/omms-remember` per host in `docs/using-memory.md`, `docs/claude-code-adapter.md`, `docs/pi-adapter.md` and `docs/opencode-adapter.md`; verify with Prettier

## 7. Web Memorisation page

- [x] 7.1 Write failing API tests for `GET /api/memorisations` (current project, active and linked spaces, newest first, memorisations only) and `GET /api/memorisations/recall?q=` (ID and text); add the routes in `src/services/memorisation-routes.ts`, register them in `src/services/web-route-modules.ts`, and verify they pass
- [x] 7.2 Add the `memorisation` view to `web/src/lib/routes.ts`, `MAIN_NAV` after `profile`, `AppSidebar.tsx` labels and `App.tsx`; verify direct load and reload of `/memorisation` in a route test
- [x] 7.3 Build the page (list, row detail, recall search with scores, Copy ID, Delete with confirmation, empty state, repeat choice and size cap box with Characters or Tokens choice, both saving through `PATCH /api/settings` and showing the range on a refused value) using the `omms-design` skill; keep each file under 500 lines
- [x] 7.4 Add every new string in en, zh and ar to `web/src/lib/i18n/translations.ts` with British English; verify `tests/web-translations-parity.test.ts` passes
- [x] 7.5 Check the page in the browser at desktop and 390px width in a scratch HOME on a free port, in English and Arabic; save screenshots to the scratchpad
- [x] 7.6 Document the page in `docs/web-ui-memory.md` and add any new guide to `docs/README.md`; verify with Prettier

## 8. Integration

- [x] 8.1 Live check in a scratch HOME with its own port and store: in Claude Code, run `/omms:omms-remember`, then in a new session ask "what were we gonna do with <topic>" and confirm the agent calls `recall`, gets the `ms-` record, and that the record never appears in per-prompt recall rows
- [x] 8.2 Run `bun run ci:local` in the worktree and confirm it exits 0
- [x] 8.3 Run `graphify update .`

## 9. Labels and bulk delete

- [x] 9.1 Keep the labels a user names when memorising: `memorise` stores every caller label (trimmed, lower-case, no repeats) beside the fixed `memorisation` tag, on every host and in the CLI; add the `parseTagList`, `visibleTags` and `hasAllTags` helpers (`tests/memorisation-core.test.ts`, `tests/memory-operations-memorise.test.ts`)
- [x] 9.2 Add `tags` to `recall` in the shared operation (labels only lists the newest labelled records, labels with text read a pool of 200 hits then filter, an exact ID ignores `tags`) and to the tool text (`tests/memory-operations-memorise.test.ts`)
- [x] 9.3 Accept `tags` for `recall` in the OpenCode V2 schema and tool, the Pi tool and the Claude Code mod, and `--tags` on `memory recall` in the CLI (`tests/memorisation-labels-tool-parity.test.ts`, `tests/cli-memorise-args.test.ts`, `bash scripts/test-claude-mod.sh`)
- [x] 9.4 Add `tags` to `GET /api/memorisations` and `GET /api/memorisations/recall`, filtering before the 200-row cap and across linked spaces, and return each row's labels without the fixed tag (`tests/memorisation-routes.test.ts`)
- [x] 9.5 Add `POST /api/memorisations/bulk-delete` with the 1 to 500 ID limit, the `deleted` and `skipped` reply and the reasons `not-found`, `linked` and `not-memorisation`, active space only (`tests/memorisation-routes.test.ts`)
- [x] 9.6 Update `skills/omms-remember/SKILL.md` (pass every user label in `tags`, add 1 to 3 of its own, recall by label) and `skills/omms-memory/SKILL.md` (route "the memorisation labelled X" to `recall` with `tags`) (`tests/claude-plugin-assets.test.ts`, `tests/package-skills.test.ts`)
- [x] 9.7 Add the web query helpers: parse `label:X` and `label:"two words"` from the recall box, read and write `?labels=` (`web/tests/memorisation-query.spec.ts`)
- [x] 9.8 Show label pills on cards, filter the list by clicking one, show the clearable filter chips and keep the filter in the URL (`web/tests/memorisation-view.spec.tsx`)
- [x] 9.9 Read `label:X` in the recall box and send it as `tags` (`web/tests/memorisation-view.spec.tsx`)
- [x] 9.10 Add select mode: Select all, Delete selected behind one confirmation, linked cards not selectable, result line with skipped reasons (`web/tests/memorisation-view.spec.tsx`)
- [x] 9.11 Add the new strings in en, zh and ar with British English (`web/tests/memorisation-routes.spec.ts`, `tests/web-translations-parity.test.ts`)
- [x] 9.12 Document labels, recall by labels, select mode and bulk delete in `docs/using-memory.md`, `docs/cli.md` and `docs/web-ui-memory.md`; verify with Prettier
- [x] 9.13 Check the label pills, the filter chips, `label:` in the recall box and select mode with bulk delete in the browser at desktop and 390px width, in English and Arabic, in a scratch HOME on a free port; save screenshots to the scratchpad

## 10. Decision records and docs

- [x] 10.1 Write ADR-047 (`docs/adr/047-memorisations-are-a-record-kind-in-the-memory-store.md`) and add it to `docs/adr/ADR_README.md`
- [x] 10.2 Write TDR-073 (text recall behind the ANN candidates), TDR-074 (flattened confidence scores), TDR-075 (Claude Code live checks ran the global CLI copy) and TDR-076 (memory-replace import) in `docs/tdr/` and add them to `docs/tdr/README.md`
- [x] 10.3 Add the README feature line and the `docs/README.md` index entries; check that the settings in `docs/configuration.md` match `src/config.ts` and that no `mz-` ID remains

## 11. Capture skips memorise turns

- [x] 11.1 Write failing tests for the shared detector (`memorise` and `memorize`, the `mcp__omms__memory` tool name, the Bash `om-memory-system memory memorise` command, args as an object or a JSON string, other modes and tools ignored, a refused reply counted as failed) and add `src/core/memorise-turn.ts` (`tests/memorise-turn.test.ts`)
- [x] 11.2 Make `captureConversation` skip a turn with a saved memorise call before the capture model runs, record the reason `memorisation-turn` in the capture attempt record, and return it to the live and import callers (`tests/memorisation-capture-skip.test.ts`)
- [x] 11.3 Set `memorise` on each tool call in the OpenCode live reader (V1 and V2 shapes) and the OpenCode history reader (`tests/memorisation-capture-skip.test.ts`, `tests/opencode-reader.test.ts`)
- [x] 11.4 Set `memorise` in the Pi reader from the tool call and its `toolResult`, and test the Pi capture route (`tests/memorisation-capture-skip.test.ts`)
- [x] 11.5 Set `memorise` in the Claude Code transcript reader, keep it on the cleaned work unit, and test the Stop hook route (`tests/memorisation-capture-skip.test.ts`, `tests/claude-hook-api.test.ts`)
- [x] 11.6 Record the reason `memorisation-turn` in the import ledger and test it with a Pi history import (`tests/pi-importer.test.ts`)
- [x] 11.7 Return `success: false` with "mode is required: use memorise for snapshot fields" when a `memory` call has snapshot fields and no mode (`tests/memory-operations-memorise.test.ts`)
- [x] 11.8 Mutation-check the detector and each host wiring: each mutation makes a test fail
- [x] 11.9 Add the requirement "Capture skips a memorise turn", the design paragraph, ADR-047 decision 15 and the note in `docs/using-memory.md`; verify with `openspec validate add-memorisation --strict` and Prettier
- [x] 11.10 Live check in a scratch HOME on a free port: save a snapshot with each host, confirm no ordinary memory appears for the turn and the capture log shows `memorisation-turn`

## Workflow follow-up

- Run `openspec-verify-change`, then archive the change before opening the pull request.
- Open one pull request to `main`; merge only on the user's word.
