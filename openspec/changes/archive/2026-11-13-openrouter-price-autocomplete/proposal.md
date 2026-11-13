## Why

The routing block lists the providers of a model with a data policy label, but not their price. The user must open the OpenRouter website to compare cost. The Model field is plain text, so the user must know the exact OpenRouter model ID, such as `deepseek/deepseek-v4-flash`. Typing `deepseek` does not help.

## What Changes

- Each provider row in the routing block shows that provider's price for the model: input and output, in US dollars per 1M tokens. The price comes from the model endpoint list that the block already reads, so no new request is made. A provider with several endpoints shows its cheapest price. A price of zero shows as Free. An endpoint without a price shows no price.
- When the API URL is OpenRouter, the Model field suggests OpenRouter model IDs as the user types. The browser's own suggestion list (`<datalist>`) filters them, so `deepseek` lists the `deepseek/...` models. The user can still type any ID.
- A new keyless server route reads OpenRouter's public model list and caches it for one hour. It returns only the ID and name of each model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openrouter-routing`: adds the provider price and the model ID suggestions.

## Impact

- `src/services/openrouter-providers.ts`: read `pricing` from each endpoint.
- New `src/services/openrouter-models.ts` and a new route in `src/services/openrouter-routes.ts`.
- `web/src/lib/components/settings/OpenRouterRouting.tsx` (price in each row) and `ExternalApiSection.tsx` (suggestion list).
- Translations in `web/src/lib/i18n/openrouter.ts`. Docs in `docs/` for the External API card.
- No config change. No paid model call. No API key is sent.
