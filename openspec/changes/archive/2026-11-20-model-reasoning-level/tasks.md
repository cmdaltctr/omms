# Tasks

Run every command in the worktree `omms-feat-model-reasoning-level`. Check `git rev-parse --show-toplevel` and `git branch --show-current` first. For each test task: write the test, run it with `bash scripts/run-tests-isolated.sh <file>`, and confirm that it fails on the current code before you write the code. Never use the real `~/.omms`, `~/.config/omms` or port 4747.

## 1. Root cause record

- [x] 1.1 Write `docs/tdr/092-openrouter-ignores-deepseek-thinking.md` (use the next free number if 092 is taken) from `docs/tdr/TEMPLATE.md`. Record: 15 of 16 AI Cleanup batches timed out at 60 seconds; `memoryExtraParams.thinking: { type: "disabled" }` is DeepSeek's format; OpenRouter ignores it and reasoned at `default_effort` high; the fix is this change. Link TDR-051. Add the row to `docs/tdr/README.md`. Verify: `npx prettier --check` on both files passes.

## 2. Shared reasoning mapping

- [x] 2.1 Write `tests/model-reasoning.test.ts` for `src/shared/model-reasoning.ts`: `reasoningFamily` for OpenRouter, DeepSeek, `openai-responses`, other `openai-chat` and the four providers with no control; `reasoningChoices` for the `deepseek/deepseek-v4.1-flash-1017` facts, a `mandatory` model, a model without `supported_efforts`, a listed model with no facts (general choices) and no facts at all; `reasoningFields` for every family and level; `savedLevel` including `custom` for `{ max_tokens: 2000 }`; `ignoredReasoningField` for `thinking` on OpenRouter and `reasoning` on DeepSeek. Verify: the test fails before 2.2 (module missing).
- [x] 2.2 Write `src/shared/model-reasoning.ts` (design Decision 1). It imports nothing outside `src/shared/`. Verify: 2.1 passes, `tests/module-boundaries.test.ts` and `tests/host-branch-boundary.test.ts` pass.

## 3. Server: model facts and the save route

- [x] 3.1 Extend `tests/openrouter-models.test.ts`: the reply holds `supported_efforts`, `default_effort` and `mandatory` from a model's `reasoning` object (`mandatory` is always present when the model has a reasoning object), omits them when absent or malformed, and holds no other field. Verify: it fails on the current code. Then change `src/services/openrouter-models.ts` and verify it passes.
- [x] 3.2 Write `tests/model-reasoning-route.test.ts` for `POST /api/settings/external-api/reasoning` on a scratch config: Low on OpenRouter writes `reasoning.effort`; `toggle: true` on OpenRouter writes `reasoning.enabled`; Off on DeepSeek writes `thinking.type: "disabled"`; Medium on `openai-responses` writes `reasoning.effort`; High on another `openai-chat` URL writes `reasoning_effort`; a save replaces a saved `thinking` and keeps `provider` and file comments; Default removes all three fields and removes an empty `memoryExtraParams`; On for a `chat` URL and any level for `anthropic` are refused with the config unchanged; a stale revision gives 409. Verify: it fails before 3.3.
- [x] 3.3 Add the route in a new `src/services/model-reasoning-routes.ts`, register it in `src/services/web-route-modules.ts`, and let `src/config-writer.ts` accept `memoryExtraParams.reasoning`, `.reasoning_effort` and `.thinking`. No `CONFIG` import in `src/services/`. Verify: 3.2 passes and `tests/modularity-ratchets.test.ts` passes.
- [x] 3.4 Add `memoryReasoning` (only `reasoning`, `reasoning_effort` and `thinking` of the global `memoryExtraParams`) to `src/services/settings-snapshot.ts` with a test in `tests/model-reasoning-route.test.ts`. Verify: the test fails first, then passes.
- [x] 3.6 Write `tests/memory-extra-params-merge.test.ts` for `keepGlobalReasoning` and `keepGlobalExtraParams` in new `src/services/memory-extra-params-merge.ts` (design Decision 8): project with other members only keeps global `reasoning`, `reasoning_effort` or `thinking`; project with its own reasoning field wins and no global one is copied; no project `memoryExtraParams` is left alone; `provider` is still kept. Change `src/config.ts` to call `keepGlobalExtraParams` (same line count). Verify: it fails before the module exists; `tests/modularity-ratchets.test.ts` and `tests/file-size-ceiling.test.ts` pass.
- [x] 3.5 Add a test that the AI Cleanup request body and the Test route request body carry a saved `reasoning: { effort: "low" }` (spec: "Every external API call sends the saved level"). Verify: break `applySafeExtraParams` locally to confirm the test fails, then restore it.

## 4. Web: Reasoning level control

- [x] 4.1 Load the `omms-design` skill. Write `web/tests/reasoning-level.spec.tsx`: choices per family; Default names `default_effort`; no Off for `mandatory`; general choices and the nearest-level note when the model is not listed or is listed without facts; the may-refuse note for `chat`; no control and the config-file note for `anthropic`; Save disabled with the reason while the URL, provider or model is unsaved; Set in the config file for `{ max_tokens: 2000 }`; the ignored-field warning for `thinking` on OpenRouter; the posted body is `{ revision, level }`, plus `toggle: true` for an OpenRouter model with no effort list. Verify: it fails before 4.2.
- [x] 4.2 Write `web/src/lib/components/settings/ReasoningLevel.tsx` (design Decision 3). Extend `web/src/hooks/useOpenRouterModels.ts` with the optional facts. Place the control after the Model field in `ExternalApiSection.tsx`, keeping that file under 500 lines. Verify: 4.1 and `web/tests/external-api-section.spec.tsx` pass.
- [x] 4.3 Add every new text to `web/src/lib/i18n/` in English, Chinese and Arabic. Verify: `tests/web-settings-i18n.test.ts` passes and 4.1 runs once with Arabic.

## 5. Web: OpenRouter routing switch and order

- [x] 5.1 Move `ProviderRows`, `Blocked` and `useSixRowHeight` from `OpenRouterRouting.tsx` to a new `OpenRouterProviderRows.tsx` with no change in behaviour. Verify: `web/tests/openrouter-routing.spec.tsx` passes unchanged.
- [x] 5.2 Extend `web/tests/openrouter-routing.spec.tsx` and the pure helper tests: with the switch on, the posted routing has no `order`, `only` or `allow_fallbacks` and keeps `data_collection` and `zdr`; ticks and Use only these providers are disabled with the reason; turning the switch off in the same visit shows the ticks in order; load state on for `{ data_collection: "deny", zdr: true }` and off with no `provider`; rows load as C, A, B for saved order `["C", "A"]`; a tick does not move rows; a save reorders and scrolls to the top. Verify: the new cases fail on the current code.
- [x] 5.3 Add `openRouterChooses` to `RoutingState`, update `routingFromProvider` and `providerFromRouting`, add `ticksFirst` to `web/src/lib/openrouter-routing.ts`, and add the switch and the order snapshot to `OpenRouterRouting.tsx` (design Decisions 5 and 6). Add the texts in English, Chinese and Arabic. Verify: 5.2 passes and `tests/file-size-ceiling.test.ts` passes.

## 6. Documentation

- [x] 6.1 Update `docs/configuration.md`: the three reasoning fields per endpoint, the warning about `thinking` on OpenRouter, the project rule for `memoryExtraParams` (global reasoning field kept; a project reasoning field wins), and the routing without `order` when OpenRouter chooses. Verify: Prettier passes and every field name matches `src/shared/model-reasoning.ts`.
- [x] 6.2 Update `docs/web-ui-settings.md`: the Reasoning level control with a choice table, the Let OpenRouter choose the provider switch (ticks kept only until reload), and the ticked-first order. Verify: Prettier passes and the anchors from `docs/configuration.md` resolve.

## 7. Integration checks

- [x] 7.1 Browser check with Orca (`orca-cli` skill) on a scratch HOME and a free port (check with `lsof -iTCP:<port> -sTCP:LISTEN`), after `bun run build`. Point the scratch config at OpenRouter with `deepseek/deepseek-v4.1-flash-1017` and a saved `thinking` block. Check: the warning shows; the choices are Default (high), Off, Low, High, Max; saving Low writes `reasoning.effort` and removes `thinking` in the scratch config; the switch and ticked-first order work. Take screenshots at desktop width, at 390 px wide, and with Arabic. Close the tab and stop the server.
- [x] 7.2 Run `bun run ci:local` and read the final exit line. Verify: it passes.
- [x] 7.3 Run `graphify update .` if `graphify-out/` exists. (No `graphify-out/` in this worktree; nothing to update.)

## Workflow follow-up

- Run the `openspec-verify-change` skill and `openspec validate model-reasoning-level --strict`.
- Archive the change with the `openspec-archive-change` skill before the pull request.
- Ask the user before commit and push.
