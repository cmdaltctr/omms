# Tasks

## 1. Dependencies and baseline

- [x] 1.1 Set `@opencode/plugin` to `^2.0.16` under `devDependencies` (remove it from `dependencies`), run `bun install`, and verify that `bun run typecheck` passes and `bun.lock` records 2.0.16
- [x] 1.2 Update `tests/package-dependencies.test.ts` for the new placement and add an assertion that `src/` contains no non-`import type` import of `@opencode/plugin`; verify the test passes

## 2. Shared retrieval module

- [x] 2.1 Create `src/core/retrieval.ts` with `buildRetrievalSection(prompt, directory, sessionId)` (moved from `src/adapters/pi/retrieval.ts`), `wrapRetrievalSection(text)` producing `<omms-retrieval>…</omms-retrieval>`, and `formatMemoriesForCompaction` (moved from `src/index.ts`, together with its tag-footer helpers); verify with unit tests for empty prompt, no results, `excludeCurrentSession` filtering, and tag wrapping
- [x] 2.2 Switch the Pi extension to the shared module, delete `src/adapters/pi/retrieval.ts`, and verify that `tests/pi-extension.test.ts` and `tests/pi-adapter-boundary.test.ts` pass with the new `<omms-retrieval>` tag
- [x] 2.3 Extract `recordUserPrompt(sessionID, messageID, directory, text)` from V1 `chat.message` (prompt save plus the structured-prompt and internal-session guards), call it from V1 `chat.message`, and verify that `tests/user-prompt-*.test.ts` and `tests/auto-capture*.test.ts` still pass

## 3. Native OpenCode v2 retrieval

- [x] 3.1 In `src/v2/adapter.ts`, replace the legacy `chat.message` call in `session.hook("prompt")` with `recordUserPrompt` plus a non-awaited `buildRetrievalSection` search stored per session; verify with an adapter test that the search starts once per prompt
- [x] 3.2 In `session.hook("context")`, await the pending search with a bounded timeout (new constant in `src/services/request-timeouts.ts`) and push the wrapped section into `event.system`; verify with tests that (a) several `context` calls for one prompt push the same section and search once, (b) a later prompt replaces the section, (c) an empty result adds nothing, and (d) a thrown or timed-out search adds nothing and does not throw
- [x] 3.3 Honour `isConfigured()` and `chatMessage.enabled` in the v2 prompt path; verify with a test that no search runs when disabled
- [x] 3.4 Keep the `chat.params` bridge in `context` (model recording for `opencodeModel: "inherit"`); verify the existing assertion in `tests/v2-plugin-adapter.test.ts` still passes

## 4. Native OpenCode v2 compaction

- [x] 4.1 Register `session.hook("compaction")`: when `compaction.enabled`, load `searchMemoriesBySessionID` for the session, format it, and store it as the session's restored section; verify with a test that later `context` calls include the restored section and that nothing calls `ctx.session.synthetic` or `ctx.session.prompt`
- [x] 4.2 Filter `session.compaction.ended` and `session.compacted` out of the v2 event bridge before calling legacy `event`; verify with a test that the V1 compaction handler is not invoked on v2
- [x] 4.3 Verify with a test that compaction restore is skipped when `compaction.enabled` is false

## 5. Lifecycle, identity and structured output on v2

- [x] 5.1 Cap the per-session maps at 256 entries, clear an entry on `session.deleted`, and clear all of them in the `setup` cleanup; verify with a test that cleanup empties state and aborts the subscription
- [x] 5.2 Add a test that, on v2, structured output for a generated session goes through `ctx.generate.text` and never calls `ctx.session.prompt`, `ctx.session.create`, or `ctx.agent.transform`, and that the legacy `config` hook is never invoked by the adapter
- [x] 5.3 Verify that `tests/plugin-v2-loader-contract.test.ts` and `tests/plugin-loader-contract.test.ts` assert the default export has `id: "omms"`, a `setup` function, and a `server` function
- [x] 5.4 Register the v2 `memory` tool with `options: { codemode: false }` so it is a direct tool; verify the adapter test asserts the option and a live OpenCode 2.0.14 request lists `memory` among direct tools

## 6. Rename code identifiers and messages to omms

- [x] 6.1 Rename `OpenCodeMemPlugin` → `OmmsPlugin`, `OpenCodeMemPluginV2` → `OmmsPluginV2`, `OpenCodeMemConfig` → `OmmsConfig`, and `opencodeMemPiExtension` → `ommsPiExtension` across `src/` and `tests/`; verify with `bun run typecheck`
- [x] 6.2 Rename `Symbol.for("opencode-mem.*")` keys to `omms.*` (plugin warmup, logger, embedding) and verify that the V1, v2 and Pi entries share the same warmup key
- [x] 6.3 Replace `opencode-mem:` error prefixes and `[opencode-mem]` log text with `omms` in `src/services/ai/*`, `src/adapters/**`, `src/v2/*` and `src/services/user-profile/ai-cleanup.ts`, update the affected test expectations, and verify those tests pass
- [x] 6.4 Rename `STRUCTURED_OUTPUT_AGENT` to `omms-structured` and the `STRUCTURED_OUTPUT_METADATA` key to `omms`, update the V1 agent description, and verify that `tests/opencode-provider.test.ts` and `tests/compaction-agent-preservation.test.ts` pass
- [x] 6.5 Set the export document's `plugin.package` to `omms` and verify that `tests/memory-portability*.test.ts` pass, including importing an existing export whose `package` is `opencode-mem`

## 7. Legacy-compatible renames

- [x] 7.1 Project config: prefer `.opencode/omms.jsonc` and `.json`, fall back to `.opencode/opencode-mem.jsonc` and `.json`; verify with config-resolution tests for new-only, legacy-only, and both (new wins)
- [x] 7.2 Project marker: accept `.omms-project` and legacy `.opencode-mem-project` with identical project identity; verify in `tests/project-scope.test.ts`
- [x] 7.3 Auth header: send and accept `x-omms-token` and keep accepting `x-opencode-mem-token` in both `auth-token.ts` and `web-api-auth.ts`; verify with `tests/web-api-auth.test.ts` cases for both headers
- [x] 7.4 Token file: move to `~/.omms/.auth-token` (create the directory with mode 0700), adopting the legacy token when the new file is missing and leaving the legacy file untouched; verify with a test using a temporary HOME
- [x] 7.5 Rename the HTML-injected token to `window.__OMMS_TOKEN__` in `web-server.ts` and `web/src/lib/api.ts`, and switch the web UI header to `x-omms-token`; verify with `tests/web-server-*.test.ts` and `bun run web:build`
- [x] 7.6 Internal capture session title: `omms capture`, with `isInternalCaptureSessionTitle` also accepting `opencode-mem capture`; verify in `tests/internal-capture-sessions.test.ts`
- [x] 7.7 Web UI: brand `omms` in translations; `omms-theme` and `omms-lang` keys that read the legacy key once and write the new one; update `web-api-auth` error text to name `omms.jsonc`; verify with `bun run web:build` and a manual check in the web UI
- [x] 7.8 Add `tests/legacy-name-guard.test.ts`, which scans `src/` and `web/src/` for `opencode-mem|OpenCodeMem|OPENCODE_MEM` with an explicit allowlist for the legacy fallbacks in design D7; verify that it passes, and that it fails when a stray name is added temporarily

## 8. Docs

- [x] 8.1 Update `README.md` for OpenCode v2 (`"plugins": ["omms"]`, per-prompt retrieval behaviour, V1 `injectOn` scoped to the V1 entry, new config, marker and header names with their legacy fallbacks) and verify that `bun run format:check` passes
- [x] 8.2 Update `docs/pi-adapter.md` (`<omms-retrieval>`, `.opencode/omms.jsonc`) and the other `docs/*.md` mentions; verify that no non-legacy `opencode-mem` references remain, using `grep -rn opencode-mem docs README.md`

## 9. Verification

- [x] 9.1 Run `bun run check` and `bun run build`, and verify both succeed
- [x] 9.2 Run `bash scripts/run-tests-isolated.sh` and verify zero failures, with the pass count at or above the 589 baseline
- [x] 9.3 Manual OpenCode v2 check (installed 2.0.14): add the built `dist/plugin.js` to `plugins` in a scratch project, run `opencode api get /api/plugin` to confirm that `omms` is active, and confirm in a session that a second prompt receives relevant memory and that no synthetic memory message appears in the transcript
- [x] 9.4 Manual Pi check (installed 0.87.1): run `pi -e <repo>` in a scratch project and confirm that the `omms` status appears and that retrieval injects an `<omms-retrieval>` section
- [x] 9.5 Run `openspec validate opencode-v2-native --strict` and verify the change is valid
