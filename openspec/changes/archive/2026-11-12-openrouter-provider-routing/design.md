# Design

## Context

- The External API card (`ExternalApiSection.tsx`, 312 lines) edits `memoryProvider`, `memoryApiUrl`, `memoryModel` and the key source. It has no presets.
- `memoryExtraParams` is read from the global config and copied into the body of every memory-model request by `applySafeExtraParams` (OpenAI chat, OpenAI responses, Anthropic, AI cleanup, category cleanup). It is not in the Settings page's editable keys, because it is a free-form object.
- `src/services/web-server.ts` is at its file-size ceiling (1837). New routes go in a route module.
- OpenRouter's request field `provider` takes `order`, `only`, `allow_fallbacks`, `data_collection` and `zdr` (OpenRouter docs, provider selection). Checked on 2026-11-12: both list endpoints answer without a key. `endpoints/zdr` returned 1,092 rows with `model_id`, `provider_name`, `tag` and `safety_retention`.

## Goals / Non-Goals

**Goals:**

- Choose OpenRouter in one step, and restrict which providers see OMMS text.
- Show, per provider of the chosen model, whether it keeps data, from OpenRouter's own lists.
- Keep the choice in the existing config, so every memory-model call and every host follows it.

**Non-Goals:**

- No OpenRouter account settings (those live on openrouter.ai).
- No live model search. The user types the model ID, as today.
- No sorting by price or speed, quantisation filters, or price caps.
- No routing for the embedder or the reranker.
- No retention periods or training flags for providers outside the ZDR list. The public JSON does not carry them.

## Decisions

1. **Save to `memoryExtraParams.provider`, not a new key.** Every request path already copies `memoryExtraParams`, so there is nothing new to wire through and no host change. A dedicated route writes only the `provider` member and keeps the other members (for example `thinking`). Clearing all choices removes `provider`, and removes `memoryExtraParams` when nothing else is left. Alternative: a new `openrouterRouting` key merged at request time. Rejected: a second path into the request body, and two places that can set `provider`.
2. **Fetch the lists on the server.** The page calls `GET /api/settings/external-api/openrouter-providers?model=<id>`. The server fetches the model's endpoints and the ZDR list, joins them on the endpoint `tag` (falling back to the provider name), and returns rows of `{ slug, name, policy }`, where `policy` is `zdr`, `safety` or `unknown`. Reasons: one place to cache, no browser cross-origin rules, and the page never talks to a third party. The ZDR list is cached in memory for one hour; the model list is not cached. A timeout of 10 seconds applies to each fetch.
3. **Slug is the provider part of `tag`.** OpenRouter's `only` and `order` take provider slugs such as `deepinfra`. The endpoint `tag` is `deepinfra/fp4`; the slug is the part before the first `/`. Rows for the same slug (several quantisations) merge into one row; the merged policy is the weakest of its rows, so the label never claims more privacy than one of its endpoints gives.
4. **Ticked providers become `order` and `only`.** The tick order is the try order. With **Use only these providers** off, the page saves `order` only, and OpenRouter may fall back to others that pass the switches. With it on, the page saves `only` and `allow_fallbacks: false`, so a request fails rather than go elsewhere.
5. **The switches are OpenRouter's own filters.** `data_collection: "deny"` and `zdr: true` are enforced by OpenRouter per request, including on fallbacks. The labels are information; the switches are the enforcement.
6. **Preset detection by host.** The card shows the OpenRouter block when the API URL's host is `openrouter.ai`, whether set by the preset or typed. The preset sets `memoryProvider` to `openai-chat` and the URL; it does not touch the model or the key.
7. **Pure helpers, no `CONFIG` import.** `openrouter-providers.ts` takes `fetch` and the clock as arguments. `web/src/lib/openrouter-routing.ts` builds the `provider` object from the card state and back, so both are unit-tested without a server.
8. **Routing needs a saved OpenRouter URL.** Added after review on 2026-11-12. A `provider` field sent to another API (OpenAI, Anthropic) can make every memory-model call fail, and the hidden block then gives no way to clear it. So the save route refuses a non-clearing save unless the saved `memoryApiUrl` host is `openrouter.ai`, checked inside the writer queue against the checked revision. A clearing save is always allowed, and the card offers **Remove OpenRouter routing** when a `provider` object is saved but the URL is not OpenRouter.

## Risks / Trade-offs

- OpenRouter can rename fields. The join reads `tag`, `provider_name`, `model_id` and `safety_retention` only; a missing field gives `unknown`, never `zdr`.
- The ZDR list may be up to an hour old. OpenRouter still enforces `zdr` per request, so a stale label cannot leak data while the switch is on.
- A hand-typed slug may be wrong. OpenRouter then has no provider to use; the Test button shows its error.
- A user who already hand-edited `memoryExtraParams.provider` with fields the card does not know (for example `sort`) keeps them: the route merges the card's fields over the saved object and leaves unknown fields alone. The card says that other routing fields are set in the config file.
