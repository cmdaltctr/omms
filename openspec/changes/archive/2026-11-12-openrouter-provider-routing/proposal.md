# Proposal

## Why

OpenRouter sends one model request to one of several providers. Some providers keep prompts, and some train on them. OMMS sends memory text and chat turns to the memory model, so the user wants to choose which providers may see that text.

Today OMMS can already reach OpenRouter: it speaks the OpenAI chat format, and `memoryExtraParams` is copied into each request body. But the Settings page has no OpenRouter preset and cannot edit `memoryExtraParams`. The only way to restrict providers is to hand-edit `omms.jsonc` with the right OpenRouter field names. The user also cannot see which providers serve a model, or which of them keep data.

OpenRouter publishes both facts without an API key:

- `GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` lists the providers that serve one model.
- `GET https://openrouter.ai/api/v1/endpoints/zdr` lists every zero data retention (ZDR) endpoint, with a `safety_retention` flag for endpoints that keep prompts only for abuse checks.

## What Changes

- The **External API** card gets a **Preset** choice: **Custom** or **OpenRouter**. OpenRouter fills the API URL `https://openrouter.ai/api/v1` and the provider `openai-chat`. The card treats any saved URL on the host `openrouter.ai` as OpenRouter.
- For OpenRouter, the card shows an **OpenRouter routing** block:
  - **Block providers that may train on or store data**: sets `data_collection: "deny"`.
  - **Zero data retention only**: sets `zdr: true`.
  - **Providers for this model**: after the user enters a model ID, the card lists the providers that serve it. Each row shows the provider name and a data policy label: **No retention** (ZDR), **Abuse checks only** (ZDR with safety retention) or **May keep or train on data** (not on the ZDR list). The user ticks providers in the order to try. A text field adds a provider slug by hand, for a provider the list does not show.
  - **Use only these providers**: off lets OpenRouter fall back to other providers that pass the switches; on sets `allow_fallbacks: false`.
  - With **Zero data retention only** on, rows labelled **May keep or train on data** are shown disabled with the reason.
- The block saves to `memoryExtraParams.provider` in the global config, as OpenRouter's `provider` request object. Other `memoryExtraParams` keys stay unchanged. Every memory-model call already copies `memoryExtraParams` into its request, so capture, profile learning, cleanup, tagging, chat and the Test button all follow the choice. No new config key.
- A new web route reads the two OpenRouter lists on the server and returns one list for a model, with labels. It caches the ZDR list for one hour. If OpenRouter cannot be reached, the card says so and keeps the manual slug field and the switches.
- Routing saves only once the OpenRouter URL is saved. If a `provider` object is saved and the URL is later changed to another API, the card warns and offers **Remove OpenRouter routing**, because other APIs may reject the field.
- Docs: `docs/web-ui-settings.md` (External API section) and `docs/configuration.md` (`memoryExtraParams.provider` example).

## Capabilities

### New Capabilities

- `openrouter-routing`: the OpenRouter preset, the provider list with data policy labels, and the routing choices saved to `memoryExtraParams.provider`.

### Modified Capabilities

None. The External API card keeps its current fields and behaviour.

## Impact

- `web/src/lib/components/settings/ExternalApiSection.tsx` (312 lines): adds the preset and mounts a new `OpenRouterRouting.tsx` component, so the card stays under 500 lines.
- New `web/src/lib/openrouter-routing.ts`: pure helpers (detect OpenRouter URL, build the `provider` object, label rows).
- New `web/src/lib/i18n/openrouter.ts`: texts in English, Chinese and Arabic.
- New `src/services/openrouter-providers.ts`: fetch, merge and cache the two lists. Takes `fetch` as an argument for tests. No `CONFIG` import.
- `src/services/web-server.ts` or a route module: `GET /api/settings/external-api/openrouter-providers?model=` and `POST /api/settings/external-api/openrouter-routing` (writes or clears `memoryExtraParams.provider`).
- `src/services/global-config-writer.ts`: one nested write that keeps the other `memoryExtraParams` keys.
- `src/services/settings-snapshot.ts`: returns the saved `memoryExtraParams.provider` so the card can show it.
- No change to the providers, the hosts, or the request path. Pi, OpenCode and Claude Code all read the same global config.
- Privacy: the route sends only the model ID to OpenRouter, and no API key. It never sends memory text.
