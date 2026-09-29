# Tasks

## 1. Host unions and model rule

- [x] 1.1 Add `"claude-code"` to `MemoryHost` (`src/types/index.ts`), `ImportHost` (`src/importer/import-args.ts`), `BackfillHost` (`src/importer/backfill-model.ts`, `src/services/backfill-state.ts`), `ImportSourceKind` (`claude-projects` in `src/importer/import-sources.ts`), and the inline unions in `web-server.ts`, `import-readiness.ts`, and `map-suggestions.ts`. Add a `hostLabel()` helper and replace the `host === "pi" ? "Pi" : "OpenCode"` ternaries. Verify: `bun run typecheck` passes and existing host tests still pass.
- [x] 1.2 Add `resolveClaudeCodeLiveModel(config)` to `src/services/ai/live-model-choice.ts` (design decision 8) with tests in `tests/live-model-choice.test.ts`: fully configured gives `manual`, each missing key is reported, and the OpenCode and Pi results are unchanged. Verify: the new tests fail before the function exists and pass after.
- [x] 1.3 Make the Claude Code backfill model resolver always return the external API selection and reject a `claudeBackfillModel` config key. Verify: a test in `tests/backfill-model.test.ts` shows no key is read and the missing-setting reason matches the Pi wording.

## 2. Transcript reader (test first)

- [x] 2.1 Add `tests/fixtures/claude-transcripts/` with a redacted session covering a string prompt, a text-block prompt, tool_use and tool_result pairs, thinking blocks, a sidechain, a meta entry, an unknown entry type, and one broken line. Verify: the fixture loads in the tests of 2.2.
- [x] 2.2 Write failing tests in `tests/claude-conversation.test.ts` for `extractClaudeConversationWindows`: window count, prompt text, `textResponses`, `toolCalls` with inputs, `sourceEntryIds`, `sourceTimestamp`, project directory from `cwd`, sidechain and meta entries skipped, tool results never a prompt, thinking dropped, unknown types and broken lines counted. Verify: tests fail before the module exists.
- [x] 2.3 Implement `src/importer/claude-conversation.ts` (design decision 5). Verify: every test from 2.2 passes with `bun test tests/claude-conversation.test.ts`, and each fails again when the matching code is removed.
- [x] 2.4 Write failing tests in `tests/claude-reader.test.ts` for discovery under a temp root: session list with directory and date, lazy unit loading, `--root` override, default root `~/.claude/projects`, and unreadable file reporting. Verify: tests fail before the module exists.
- [x] 2.5 Implement `src/importer/claude-reader.ts` as a `LazyImportSource`. Verify: tests from 2.4 pass.

## 3. Terminal import and web import surfaces

- [x] 3.1 Add `import-claude-history` to `COMMANDS` in `src/cli/index.ts`, `--root` to `SOURCE_FLAG` for `claude-code`, and a `claude-code` branch in `run-import.ts`. Verify: `tests/import-args.test.ts` covers the new host with the shared flags, and `om-memory-system import-claude-history --help` prints the flags.
- [x] 3.2 Add a dry-run test that imports the fixture from 2.1 through `importHistorySource` with host `claude-code`, then a real run with a stub provider, then a rerun. Verify: the dry run stores nothing, the run stores one memory per window, and the rerun skips every unit through the ledger.
- [x] 3.3 Add a test that a window whose `sourceEntryIds` already exist on a live-captured memory is skipped by the import. Verify: `tests/import-skips-live-capture.test.ts` (or the existing equivalent) passes for host `claude-code`.
- [x] 3.4 Extend `import-sources.ts`, `import-readiness.ts`, `import-sessions.ts`, and `web-import-api.ts` for the `claude-projects` source kind. Verify: the existing source tests pass for the new kind, and `GET /api/settings/imports/readiness` lists Claude Code.

## 4. Web app routes and capture worker (test first)

- [x] 4.1 Write failing tests in `tests/claude-hook-api.test.ts` with a stub provider and a temp storage path: retrieve for `startup`, `compact`, and `prompt` returns the expected wrapped text; capture reads only windows after the cursor, appends `last_assistant_message` when the transcript lags, stores the cursor, is a no-op on a repeated request, skips a fully private prompt, queues a retryable failure, and rejects a request without the token. Verify: tests fail before the module exists.
- [x] 4.2 Move the OpenCode first-message memory list into a shared function in `src/core/retrieval.ts` and call it from `src/index.ts`. Verify: existing OpenCode injection tests pass unchanged.
- [x] 4.3 Implement `src/importer/claude-hook-api.ts` and `src/services/claude-capture-cursor.ts` (design decisions 4, 6, 7) with the cursor table in `user-prompts.db`, the in-process queue, `queueFailedCapture`, prompt recording, profile learning with the external API model passed in directly (not through `registerHostProfileModel`), and the once-per-process backfill trigger. Verify: tests from 4.1 pass.
- [x] 4.4 Register `POST /api/claude/retrieve` and `POST /api/claude/capture` in `web-server.ts` behind `isAuthorizedApiRequest`, and register the `claude-code` retry drain at web app start. Verify: a server test posts to both routes with and without the token and gets 200/202 and 401.
- [x] 4.5 Add the Claude Code backfill to `backfill-controls.ts` and the `/api/settings/backfill/claude-code/(run|pause|resume)` routes. Verify: `tests/backfill-controls.test.ts` covers run, pause, resume, single-run lock, and the missing-external-API reason for the new host.

## 5. Hook client and CLI commands (test first)

- [x] 5.1 Write failing tests in `tests/claude-hook-client.test.ts` with a fake server and fake spawn: reads stdin JSON, stops reading after the input limit, finds a running server, starts one when health fails and polls until up, gives up inside the budget, prints `hookSpecificOutput` for `session-start` and `user-prompt-submit`, prints nothing for `stop`, truncates context at 9,500 characters keeping the closing tag, exits 0 on every failure, and logs one metadata line without prompt text. Verify: tests fail before the module exists.
- [x] 5.2 Implement `src/adapters/claude-code/hook-client.ts` and `hook-command.ts` (design decisions 2 and 3) and wire `claude-hook <event>` into `src/cli/index.ts`. Verify: tests from 5.1 pass and `echo '{}' | om-memory-system claude-hook stop` exits 0.
- [x] 5.3 Add `om-memory-system memory <mode> [flags]` (design decision 9) with tests in `tests/cli-memory.test.ts`: `add`, `search`, `list`, `forget`, unknown mode error, `<private>` stripping, host `claude-code` on stored rows, JSON on stdout. Verify: tests pass and `om-memory-system memory --help` prints the modes.
- [x] 5.4 Add `tests/claude-code-adapter-boundary.test.ts` and extend `tests/plugin-bundle-boundary.test.ts` so the OpenCode bundle excludes `adapters/claude-code`. Verify: both tests pass, and the boundary test fails when a forbidden import is added.

## 6. Plugin assets

- [x] 6.1 Add `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` (SessionStart 20 s, UserPromptSubmit 10 s, Stop 60 s async), and `skills/omms-memory/SKILL.md`. Verify: `claude plugin validate .` passes and a test asserts the three events, timeouts, and `async: true` on Stop.
- [x] 6.2 Manual check on this machine: install the plugin from the local marketplace, run one Claude Code turn, and confirm a memory with host `claude-code` appears in the web app, that `UserPromptSubmit` injects it on the next prompt, and that the hooks exit 0 with the web app stopped. Verify: record the result in the pull request.
  - Result (Claude Code 2.1.284): the plugin ran from `--plugin-dir` in a live session. SessionStart started the web app, Stop saved one `claude-code` memory, and the next session got it back through SessionStart and UserPromptSubmit. The hooks exited 0 with the web app stopped, disabled, or blocked by another program on the port.
  - Marketplace install, checked in a throwaway `HOME`: `claude plugin marketplace add <repo>` then `claude plugin install omms@omms` gave `omms@omms` 3.5.0, enabled, with `hooks/hooks.json` in the plugin cache.
  - Command missing: with `om-memory-system` off `PATH`, the hooks exit 127. A live `claude -p` run with the plugin loaded still exited 0 and answered normally.

## 7. Web UI

- [x] 7.1 Add the Claude Code backfill card, import readiness entry, and import form source in `web/src`, with Chinese and Arabic strings. Verify: `bun run check`, `tests/web-settings-i18n.test.ts`, and the web build pass.
- [x] 7.2 Show the "Claude Code capture is off" status and the missing setting on the Settings page when the external API is not fully configured. Verify: a settings test returns the status for a half-configured API.

## 8. Docs and records

- [x] 8.1 Write `docs/claude-code-adapter.md` (install, hooks block for a hand edit, external API requirement, `memory` command, the Claude Code version the reader targets) and `docs/claude-code-history-import.md`. Verify: `bun run check` passes on the Markdown.
- [x] 8.2 Update `docs/cli.md`, `docs/configuration.md`, `docs/shared-core.md`, `docs/web-ui-settings.md`, `README.md`, and `CONTRIBUTING.md` for the new commands, routes, and host. Verify: each doc names `claude-code` where it lists hosts.
- [x] 8.3 Add ADR 013 for the hooks-plus-web-app shape and the external-API-only rule, and add it to `docs/adr/ADR_README.md`. Verify: the index row and file exist.

## 9. Gate

- [x] 9.1 Run `bun run ci:local` and fix every failure. Verify: the command passes.
- [x] 9.2 Run `openspec validate add-claude-code-host --strict` and the `openspec-verify-change` skill. Verify: no findings.
