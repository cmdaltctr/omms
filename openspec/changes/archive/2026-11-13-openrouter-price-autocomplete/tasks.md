## 1. Tests first

- [x] 1.1 `tests/openrouter-providers.test.ts`: price per row, lowest of several endpoints, missing or bad price gives no `price`, zero prices kept. Confirm the new tests fail on the current code.
- [x] 1.2 New `tests/openrouter-models.test.ts`: ID and name only, sorted, one fetch within an hour, failed read not cached, timeout and bad shape give `ok: false`.
- [x] 1.3 `web/tests/openrouter-routing.spec.tsx`: a row shows `$0.26 in · $0.71 out / 1M tokens`, `Free`, and no price text when `price` is absent.
- [x] 1.4 Web spec for the Model field: datalist present with OpenRouter URL, absent with another URL, absent when the list request fails.

## 2. Server

- [x] 2.1 Read `pricing` in `src/services/openrouter-providers.ts` and add `price` to `ProviderRow`.
- [x] 2.2 Add `src/services/openrouter-models.ts` and the `GET /api/settings/external-api/openrouter-models` route in `src/services/openrouter-routes.ts`.

## 3. Web

- [x] 3.1 Show the price in `ProviderRows` with a price formatter in `web/src/lib/openrouter-routing.ts`.
- [x] 3.2 Add a hook that loads the model list, and the datalist on the Model field in `ExternalApiSection.tsx`.
- [x] 3.3 Add Chinese and Arabic texts in `web/src/lib/i18n/openrouter.ts`.

## 4. Docs and checks

- [x] 4.1 Update the External API section of the settings guide in `docs/`.
- [x] 4.2 Browser check at desktop and 390 px width with a scratch HOME; no real `~/.omms`.
- [x] 4.3 `bun run ci:local` passes.
