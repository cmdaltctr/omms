## Context

`createOpenRouterProviders` reads `GET /models/{id}/endpoints` and folds the endpoints into one row per provider slug. Each endpoint carries `pricing.prompt` and `pricing.completion` as decimal strings in US dollars per token (checked on 2026-11-13: DeepInfra for `deepseek/deepseek-chat` gives `0.000000256` and `0.000000712`). `GET /models` returns about 470 models without a key, each with `id`, `name` and more.

## Goals / Non-Goals

**Goals:**

- Show the price that OpenRouter lists, with no extra request.
- Suggest model IDs with the browser's own control, so keyboard use and screen readers work as for any text field.

**Non-Goals:**

- No price for the model as a whole, and no cost estimate per capture.
- No suggestions for other API hosts.
- No custom dropdown component.

## Decisions

1. **Price per provider row.** `ProviderRow` gets an optional `price: { input: number; output: number }` in US dollars per 1M tokens. While folding endpoints, take the lowest finite, non-negative input and output values per slug. A non-numeric or missing value is skipped; a slug with no valid value has no `price`. Format: `$0.26 in · $0.71 out / 1M tokens`, two decimals, four when the value is under $0.01. Zero for both shows `Free`. Alternative: show every endpoint. Rejected: the row is one provider, and the cheapest price is what routing by order picks first.
2. **Model list module.** New `src/services/openrouter-models.ts` with `createOpenRouterModels({ fetch, now })`, the same shape as the providers module: keyless GET, 10-second timeout, one-hour cache of a good answer only. It returns `{ ok: true, models: { id, name }[] }` sorted by ID, or `{ ok: false, error }`. Route: `GET /api/settings/external-api/openrouter-models` in `openrouter-routes.ts`.
3. **Suggestions with `<datalist>`.** `ExternalApiSection` loads the list once when the URL field first holds an OpenRouter URL and renders `<datalist id="openrouter-models">` with one `<option value={id}>{name}</option>` per model; the Model input gets `list="openrouter-models"` only then. Chromium and Firefox match the typed text anywhere in the value or label. Alternative: a combobox component. Rejected: more code, and the browser control already filters 470 items fast. A failed load shows nothing; the field stays plain text.

## Risks / Trade-offs

- Safari's datalist matches less well than Chromium's → still a valid text field; no loss.
- OpenRouter changes the `pricing` shape → the row shows no price; the rest of the row is unchanged.
- `ExternalApiSection.tsx` is at 392 lines → the model loading goes in a small hook file so the section stays under 500.
