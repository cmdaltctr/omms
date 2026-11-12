# Tasks

## 1. Tests first

- [x] 1.1 `tests/openrouter-providers.test.ts`: with a stub `fetch`, the server joins the model endpoints and the ZDR list into one row per slug with the right label, uses the least private label for a slug with several endpoints, caches the ZDR list for one hour, and reports a timeout and an unknown model. Confirm it fails before the module exists.
- [x] 1.2 `tests/openrouter-routing-route.test.ts`: the save route writes `memoryExtraParams.provider`, keeps other `memoryExtraParams` members and unknown `provider` fields, and removes `provider` when cleared.
- [x] 1.3 A provider test proves the Test call body carries the saved `provider` object.
- [x] 1.4 `web/tests/openrouter-routing.spec.ts(x)`: URL detection, card state to `provider` object and back (order, only, allow_fallbacks), disabled rows with ZDR only, and the preset leaving model and key alone.

## 2. Server

- [x] 2.1 `src/services/openrouter-providers.ts`: fetch, join, label, cache. `fetch` and clock passed in; no `CONFIG` import.
- [x] 2.2 Routes in a route module (not `web-server.ts`, which is at its ceiling): `GET /api/settings/external-api/openrouter-providers?model=` and `POST /api/settings/external-api/openrouter-routing`, with the settings revision check the other settings routes use.
- [x] 2.3 `global-config-writer.ts`: nested write of `memoryExtraParams.provider` that keeps other members.
- [x] 2.4 `settings-snapshot.ts`: return the saved `provider` object.
- [x] 2.5 Save route refuses a non-clearing save unless the saved `memoryApiUrl` host is `openrouter.ai`; a clearing save is always allowed (review finding, 2026-11-12).

## 3. Web

- [x] 3.1 `web/src/lib/openrouter-routing.ts`: pure helpers.
- [x] 3.2 `web/src/lib/components/settings/OpenRouterRouting.tsx` with the shared controls, and the Preset choice in `ExternalApiSection.tsx`.
- [x] 3.3 `web/src/lib/i18n/openrouter.ts` in English, Chinese and Arabic; merge in `translations.ts`.
- [x] 3.4 Card disables Save routing until the OpenRouter URL is saved, and offers Remove OpenRouter routing when a `provider` object is saved for another URL. Fix the other review findings scored 4 or more and the 390 px row layout.

## 4. Docs and checks

- [x] 4.1 `docs/web-ui-settings.md`: External API preset and OpenRouter routing. `docs/configuration.md`: `memoryExtraParams.provider` example.
- [x] 4.2 Mutation check on 1.1 and 1.4.
- [x] 4.3 Browser check at 1280 px and 390 px in a scratch home on a free port, with a real model list from OpenRouter and no key.
- [x] 4.4 `bun run check`, `bun run build`, `bun run ci:local` exit 0.
- [x] 4.5 `openspec validate openrouter-provider-routing --strict`, verify, archive before the pull request.
