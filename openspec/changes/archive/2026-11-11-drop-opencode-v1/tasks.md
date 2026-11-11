# Tasks

Run each focused test with `bash scripts/run-tests-isolated.sh tests/<file>.test.ts`. Run `bun run build` first when a test imports `dist/`. Work in a sibling worktree off `origin/main`, never in the main checkout.

## 1. Port the V2 parity tests before the move

- [x] 1.1 Port the tests that call `OmmsPlugin` from `src/index.js` to call `OmmsPluginV2.setup` with a fake V2 context: `opencode-web-ensure`, `opencode-trace-startup`, `opencode-runtime-registration`, `opencode-backfill-startup`, `opencode-skills-tool`, `profile-tool-runtime`, `tool-scope`, `memory-portability-tool`, `opencode-v2-memory-session-id`. Run each against the current code and confirm it passes.
- [x] 1.2 Change `tests/v2-cache-cleanup.test.ts` so it no longer mocks `../src/index.js`. Confirm it passes on the current code.
- [x] 1.3 Add `tests/v2-session-events.test.ts`: an idle event runs capture after 10 s, then profile learning and the cleanup check; capture off with `skillLearning` on records the turn only; `session.created` starts the OpenCode retry drain; an OMMS internal session starts nothing. Run it against the current adapter and confirm it passes.
- [x] 1.4 Add a case to `tests/v2-plugin-adapter.test.ts`: with `opencodeModel` set to `"inherit"`, the `context` hook stores the request model on the prompt row; with a fixed model it does not. Confirm it passes on the current code.
- [x] 1.5 List the V1-only tests to delete in group 3, and confirm no V2 case lives in them: `v1-injection-budget`, `compaction-agent-preservation`, `first-message-memories`, the `server` cases in `plugin-loader-contract`, the `applySkillsPathConfig` and "wires both OpenCode hooks" cases in `opencode-skills`, the "OpenCode host client config" and "structured-output agent" cases in `plugin-host-config`, and the `buildRecentMemoriesSection` case in `memory-context-budget`.

## 2. Importer regression tests (fail first)

- [x] 2.1 Add a V2 fixture builder `tests/opencode-v2-fixture.ts` that creates `project`, `session_v2` and `session_message` tables with the column sets recorded in design.md, and can also add the V1 tables.
- [x] 2.2 In `tests/opencode-reader.test.ts`, add failing cases: a session only in `session_v2` is listed and gives units; a `synthetic` message is not a prompt and ends the unit; a `compaction` message ends the unit; `system`, `idle` and switch messages are ignored; a V2 `tool` item with state `error` gives outcome `error`; a child session is counted as folded; a session titled `omms capture` is skipped and not counted. Run the file and confirm these cases fail.
- [x] 2.3 Add failing cases for mixed databases: a session in both table sets is read from V2 only; a V1 session missing from `session_v2` is read from V1; a V1-only database imports as before; a database with neither table set fails with an error that names the missing tables and does not say "V1".
- [x] 2.4 In `tests/opencode-import.test.ts`, add a failing rerun case: a unit imported from the V1 tables, then read from the V2 tables with a different last-answer id, is reported as already handled and stores no second memory. Add a Pi case that proves exact-key matching is unchanged.
- [x] 2.5 Confirm that `tests/import-sources.test.ts`, `tests/opencode-web-selection.test.ts`, `tests/map-suggestions.test.ts` and `tests/opencode-cli.test.ts` still pass with their V1 fixtures, and add one V2 fixture case to `opencode-web-selection`.

## 3. Remove the V1 plugin object and move V2 work

- [x] 3.1 Create `src/v2/startup.ts` with `startOpencodeRuntime(ctx, client)`. Move the startup body of `OmmsPlugin` (`src/index.ts:268-514`) in the same order, without `configureOpencodeHostTransport`. Return `dispose`. Keep the file at 500 lines or fewer.
- [x] 3.2 Pass a `configModel` that reads the default model through the V2 context when the 2.0.16 `model` API offers a read, otherwise one that returns `null` (today's V2 result, because the legacy client has no `config.get`).
- [x] 3.3 Change `memory-tool.ts` and `skills-tool.ts` to plain executors with no `@opencode-ai/plugin` import. Create `src/v2/tools.ts` that registers both with `ctx.tool.transform`, with `codemode: false`, the existing JSON schemas and the existing result mapping.
- [x] 3.4 Create `src/adapters/opencode/prompt-model.ts` (`recordPromptModel`) and `src/v2/session-events.ts` (`session.created` and `session.idle` handling, with the 10 s wait and the internal-session check). Call them from `adapter.ts`.
- [x] 3.5 Change `registerV2Adapter(ctx, legacy, memory)` to take `deps` (tool executors, `recordPromptModel`, the event handler, `dispose`). Update `src/v2/plugin.ts`: start the runtime, then `setV2Client(legacyClient)`, then register the adapter.
- [x] 3.6 Grep for callers of `createV2Client`, `setHostFetch`, `resetHostFetch`, `getHostClientConfig` and `createLazyV2Client`. When only V1 code calls them, delete them, `opencode-host-config.ts` and `opencode-sdk-client.ts`. Remove `agent: STRUCTURED_OUTPUT_AGENT` from the structured-output body and the agent constant.
- [x] 3.7 Delete `src/index.ts`, `resolveSessionAgent`, `applyStructuredOutputAgentConfig`, `applyHistoryImportCommandConfig`, `applySkillsPathConfig`, `latestUserMessageModel` and `buildRecentMemoriesSection`. Move the test imports of `isStructuredSummaryPromptMessage` and `INTERNAL_CAPTURE_SESSION_TITLE` to their source modules. Remove `src/index.ts` from `tests/file-size-ceiling.test.ts`.
- [x] 3.8 Replace `PluginInput` in `profile-learning.ts` and `auto-capture-host.ts` with a local type. Remove `@opencode-ai/plugin` from `dependencies`. Update `bun.lock` with `bun install`. (`@opencode-ai/sdk` goes in 3.18.)
- [x] 3.9 Remove the `server` property and the `OmmsPlugin` export from `src/plugin.ts`, and the `./server` entry from `package.json`. Update `tests/plugin-loader-contract.test.ts` to assert both are absent, and drop the `createV2Client` check from `tests/plugin-bundle-boundary.test.ts`.
- [x] 3.10 Delete the V1-only tests and cases listed in 1.5. Update comments in `src/v2/` and `src/adapters/opencode/` that describe a V1 plugin or V1 hooks.
- [x] 3.11 Run every test from group 1, plus `v2-plugin-adapter`, `v2-legacy-client`, `plugin-v2-loader-contract`, `plugin-bundle-boundary`, `plugin-host-config`, `opencode-skills`, `opencode-provider`, `host-neutral-capture-boundary` and `file-size-ceiling`. All pass.

Port the V1-shaped client facade (design decision 6). Start only after 3.11 passes. Check each V2 call against the installed `@opencode/client` 2.0.16 types, not memory.

- [x] 3.12 Add failing tests through a fake V2 context: structured output makes one `generate.text` call and no session create, prompt, abort or delete; the capture conversation reader and profile learning read `session.context` V2 messages (`user`, `synthetic`, `assistant` with `content[]` text and tool items); the Settings model list groups `model.list()` by provider; `settings-models` takes a `listModels` function. Confirm each fails on the current code.
- [x] 3.13 Create `src/adapters/opencode/opencode-host.ts` (`OpencodeHost` type, `setOpencodeHost`, `getOpencodeHost`) and the pure V2 message mapper. Set the host in `src/v2/plugin.ts` in place of `setV2Client(legacyClient)`.
- [x] 3.14 Port structured output in `opencode-provider.ts` and `profile-llm-client.ts` to `generate.text`. Remove the synthetic session lifecycle and `STRUCTURED_OUTPUT_AGENT` leftovers.
- [x] 3.15 Port `conversation.ts`, `auto-capture-host.ts`, `auto-capture-summary.ts`, `profile-learning.ts`, `profile-model.ts`, `backfill-startup.ts`, `tui-recall.ts`, `import-command.ts` and `opencode-import-models.ts` to `OpencodeHost`. Port `src/importer/settings-models.ts` to a `listModels` function with no adapter import.
- [x] 3.16 Move `toLegacyEvent` and `eventBelongsToLocation` into `src/v2/session-events.ts` with V2 names. Delete `src/v2/legacy-client.ts`, `src/adapters/opencode/in-process-client.ts`, `setV2Client` and `getV2Client`.
- [x] 3.17 Change the fake V1 clients in the 13 test files that use them (`ai-cleanup`, `auto-capture`, `capture-diagnostics-parity`, `history-import-commands`, `memorisation-capture-skip`, `opencode-backfill-startup`, `opencode-capture-diagnostics`, `opencode-profile-model`, `opencode-provider`, `opencode-runtime-registration`, `opencode-skills-tool`, `plugin-host-config`, `v2-cache-cleanup`) to fake V2 contexts. Replace `tests/v2-legacy-client.test.ts` with `tests/opencode-host.test.ts`. Do not weaken an assertion.
- [x] 3.18 Remove `@opencode-ai/sdk` from `dependencies` and update `bun.lock`. Grep `src/`, `tests/` and the built `dist/` for `@opencode-ai/`; there are no hits. Run 3.12, the tests from 3.11 and 3.17, `host-neutral-capture-boundary`, `plugin-bundle-boundary` and `file-size-ceiling`. All pass.

## 4. Remove the V1-only settings

- [x] 4.1 Add failing config tests in `tests/memory-limits-config.test.ts`: an old file with `chatMessage.maxMemories` 0, `injectOn` and `maxAgeDays` loads with no error and no log line; a project `{ "chatMessage": { "enabled": true } }` over a global `{ "enabled": false, "maxMemories": 5 }` gives `enabled` true. Confirm the first case fails today.
- [x] 4.2 Add a failing case to `tests/memory-limits-settings.test.ts`: a PATCH that edits `chatMessage.maxMemories` is rejected and the file is unchanged.
- [x] 4.3 Remove `maxMemories`, `maxAgeDays` and `injectOn` from `chatMessage` in `src/config.ts` (type, `DEFAULTS`, parse) and from `src/config-template.ts`. Remove the `chatMessage.maxMemories` rule from `src/utils/memory-limits.ts` and the allowlist entry from `src/services/global-config-writer.ts`. Update the nested-setting comment in `src/services/settings-snapshot.ts`.
- [x] 4.4 Remove the `chatMessage.maxMemories` row from `web/src/lib/memory-controls.ts` and its strings from `web/src/lib/i18n/settings.ts`. Change the Memory injection host note (`MemoryInjectionSection.tsx` and its translations) so it names OpenCode V2, Pi and Claude Code only. Update `web/tests/memory-section.spec.tsx` and `web/tests/visual/settings-fixtures.ts` to five rows.
- [x] 4.5 Update the old-key stubs in `tests/config.test.ts`, `tests/pi-importer.test.ts` and `tests/memory-context-budget.test.ts`. Run 4.1, 4.2 and these files; all pass.

## 5. Fix the OpenCode importer

- [x] 5.1 Change `validateSchema` in `src/importer/opencode-reader.ts` to accept the V2 tables, the V1 tables, or both, and to fail with neither. Remove "V1" from the error text.
- [x] 5.2 Read top-level sessions from `session_v2` plus V1 sessions whose id is not in `session_v2`, with the parent, title, session, session-list and limit filters. Count child and top-level sessions across both sets once.
- [x] 5.3 Build V2 units from `session_message` by the mapping in design.md decision 5. Keep the V1 builder for V1 sessions. Keep `src/importer/opencode-reader.ts` at 500 lines or fewer; split the V2 builder into its own module if needed.
- [x] 5.4 In `src/importer/importer.ts`, for the `opencode` host only, treat a unit as handled when the ledger has an imported or skipped row for the same session id and user message id. Use the `session_id` index.
- [x] 5.5 Run the tests from group 2 and confirm they pass. Run `auto-backfill`, `import-sources`, `opencode-cli`, `opencode-import`, `opencode-web-selection`, `map-suggestions`, `skill-learning-import` and `history-import-commands`. All pass.

## 6. Documentation

- [x] 6.1 `docs/configuration.md`: remove the V1 sentence near line 151, the `chatMessage.maxMemories` row and template lines, `maxAgeDays` and `injectOn`. Add a note that OMMS ignores these keys in old files and that a project `chatMessage` object still replaces the global one.
- [x] 6.2 `docs/opencode-history-import.md`: describe the V2 tables, the V1 fallback for older `--db` copies, and the ledger match. Remove the V1 plugin wording.
- [x] 6.3 Update `docs/shared-core.md` (near line 190), `docs/developers.md` (near line 9, exports), `docs/opencode-adapter.md` (V1 leftovers, the new V2 modules), `docs/web-ui-memory.md` (five rows), `README.md`, and the `AGENTS.md` architecture rows for `src/index.ts` and `src/v2/`.
- [x] 6.4 Replace the `AGENTS.md` host-parity rule "The V1 plugin object in `src/index.ts` stays only because V2 wraps it" with the new rule: OpenCode code uses the V2 plugin API only, and tests for OpenCode go through the V2 adapter. Update `CONTRIBUTING.md` if it names V1.
- [x] 6.5 Write `docs/adr/048-omms-supports-opencode-v2-only.md` and add its row to `docs/adr/ADR_README.md`.
- [x] 6.6 Write `docs/tdr/078-opencode-importer-missed-v2-session-tables.md` with the table counts and the ledger evidence from design.md, and add its row to `docs/tdr/README.md`.
- [x] 6.7 Grep `docs/`, `README.md`, `AGENTS.md` and `web/src` for `V1`, `chat.message`, `injectOn`, `maxAgeDays`, `chatMessage.maxMemories` and `./server`. Fix every hit that is not an ADR, a TDR or the changelog. Run Prettier on the changed files.

## 7. Live check (approved scratch HOME)

- [x] 7.1 Make a scratch HOME with its own OMMS store and config. Pick a free port with `lsof -iTCP:<port> -sTCP:LISTEN`. Build the worktree and point OpenCode 2.2.6 at the built package with a version higher than the global copy.
- [x] 7.2 In OpenCode V2: call the `memory` tool (add, search, `space` list); send a prompt and see the recall row; compact a session and see the restored section in the next request; let a session go idle and see one capture in the log, with no extra session in the OpenCode session list; see profile learning run after capture; open web Settings and see the OpenCode model list.
- [x] 7.3 Run `om-memory-system import-opencode-history --dry-run` against a snapshot copy of the real database in the scratch HOME. Confirm that a V2-only session after 19 September 2026 is listed with units, and that a rerun with a copy of the real ledger reports V1-era units as already handled. Record the counts.
- [x] 7.4 Confirm that the real `~/.local/share/opencode/opencode.db`, `-wal` and `-shm` have the same size and modification time before and after 7.3.
- [x] 7.5 Stop OpenCode and the web app, close the browser tab, and remove the scratch HOME.

## 8. Verify

- [x] 8.1 Run `bun run build` and `bun run check:package`. Both pass with no `@opencode-ai/*` package installed as a dependency.
- [x] 8.2 Run `bun run ci:local` and read the final exit line. It passes.
- [x] 8.3 Run `graphify update .`.
- [x] 8.4 Run the `openspec-verify-change` skill and `openspec validate drop-opencode-v1 --strict`. Fix every finding.

## 9. Live-check follow-ups

- [x] 9.1 Add a failing test that an untagged memory is scored by content alone and a tagged one keeps the 60/40 blend (`tests/turso-vector-search.test.ts`). Score untagged memories by content in `src/services/turso/vector-search.ts`. Write TDR-079.
- [x] 9.2 Add failing tests that `inherit` uses the latest request's model before `model.json`, and works with no `model.json` through V2 setup. Remember the model in the `context` hook. Write TDR-080 and update `docs/configuration.md`.
- [x] 9.3 Group the Settings OpenCode model list by provider, with a test on interleaved input.
- [x] 9.4 Add a test that V2 setup adds no agent.
- [x] 9.5 Reword the `chatMessage` template comment and remove `opencode.hooks` from `package.json`.

## Workflow follow-up

- Archive the change with the `openspec-archive-change` skill after 8.4 passes, in the same pull request.
- Commit as `feat!: support OpenCode V2 only` with a `BREAKING CHANGE:` footer, only when the user asks. release-please then makes a major release.
- After the release is installed, offer to remove `maxMemories` and `injectOn` from the `chatMessage` block in the maintainer's `~/.config/omms/omms.jsonc`. Show the diff first and make no backup copy. Edit only on the user's word.
