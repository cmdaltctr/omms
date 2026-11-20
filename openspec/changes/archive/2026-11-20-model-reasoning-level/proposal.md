# Proposal

## Why

AI Cleanup timed out on 15 of 16 batches (60 second limit). The saved `memoryExtraParams` held `thinking: { type: "disabled" }`, which is DeepSeek's format. The calls went through OpenRouter, which ignores that field, so the model reasoned at its default effort (high) and every batch was slow. Each endpoint has its own reasoning field, and today the user must know it and type it into the config file by hand. Nothing tells the user when the saved field does not fit the endpoint.

The OpenRouter routing block has two smaller gaps. The user cannot let OpenRouter pick a cheaper provider without unticking every provider. Ticked providers also stay in OpenRouter's list order, so the try order is hard to read.

## What Changes

- Add a **Reasoning level** control to the External API card. The choices are **Default** (send nothing), **Off**, and the effort levels the model supports. The card writes the field that matches the saved endpoint:
  - OpenRouter (`openrouter.ai`): `reasoning: { effort }`, with `"none"` for Off. The choices come from the model's `supported_efforts` in OpenRouter's public model list. The card shows the model's `default_effort` and hides Off when reasoning is `mandatory`.
  - DeepSeek (`api.deepseek.com`): `thinking: { type: "enabled" | "disabled" }`, on and off only.
  - OpenAI Responses provider: `reasoning: { effort }`.
  - Any other OpenAI Chat endpoint: `reasoning_effort` with Low, Medium and High, and a note that the endpoint may ignore it.
- A level save replaces every older reasoning field (`reasoning`, `reasoning_effort`, `thinking`) and keeps every other `memoryExtraParams` member, such as `provider`.
- The card warns when the saved reasoning field does not fit the saved endpoint, for example a DeepSeek `thinking` block sent to OpenRouter.
- OpenRouter models that the list shows without reasoning facts get the general choices (Default, Off, Low, Medium, High) and a note that OpenRouter uses the nearest level the model supports.
- A project config that sets `memoryExtraParams` keeps the global reasoning field (`reasoning`, `reasoning_effort` or `thinking`), the same way it keeps `provider`. A project that sets its own reasoning field replaces all global reasoning fields.
- The server's OpenRouter model list reply also carries each model's reasoning facts.
- Add a **Let OpenRouter choose the provider** switch to the OpenRouter routing block, off by default. When it is on, the saved routing has no `order`, `only` or `allow_fallbacks`. The privacy switches (`data_collection`, `zdr`) stay.
- Ticked providers show first, in try order, then the other providers. The list reorders when it loads and after a routing save, not on each tick.
- Record the root cause in a new TDR.

## Non-goals

- Reasoning for a host session model (OpenCode `opencodeProvider`/`opencodeModel`, Pi `piProvider`/`piModel`, or `inherit`). Those calls go through the host, which does not read `memoryExtraParams`. Reasoning for them is the host's business.
- A reasoning control for the `anthropic`, `minimax`, `google-gemini` and `orcarouter` providers. Their fields stay hand-written in `memoryExtraParams`.
- A per-project level control in the web app. The card edits the global config only. A project config can still write its own reasoning field by hand (see the last What Changes bullet).
- CLI history imports with `--api-url` keep sending the saved `memoryExtraParams`, as today.
- A token budget (`reasoning.max_tokens`) or `reasoning.exclude`.

## Capabilities

### New Capabilities

- `model-reasoning-level`: the reasoning level control of the External API card, the field it writes for each endpoint, and the warning for a field that does not fit the endpoint.

### Modified Capabilities

- `openrouter-routing`: the server's model list reply carries reasoning facts; a new switch lets OpenRouter choose the provider; ticked providers are listed first in try order.

## Impact

- Shared: new pure module `src/shared/model-reasoning.ts` (endpoint family, choices, and the fields for a level), read by the server and by the web app as `$shared`.
- Server: new `src/services/memory-extra-params-merge.ts` (keeps the global provider and reasoning fields under a project `memoryExtraParams`; `src/config.ts` calls it in place of `keepGlobalProvider`), `src/services/openrouter-models.ts` (reasoning facts in the reply), new `src/services/model-reasoning-routes.ts` (save route) registered in `src/services/web-route-modules.ts`, `src/config-writer.ts` (accept the three nested reasoning keys), `src/services/settings-snapshot.ts` (saved reasoning fields).
- Web: new `web/src/lib/components/settings/ReasoningLevel.tsx`, `web/src/lib/components/settings/ExternalApiSection.tsx`, `web/src/hooks/useOpenRouterModels.ts`, `web/src/lib/openrouter-routing.ts`, `web/src/lib/components/settings/OpenRouterRouting.tsx` (split: the provider rows move to a new file to stay under 500 lines), `web/src/lib/i18n/` (English, Chinese, Arabic).
- Docs: `docs/configuration.md`, `docs/web-ui-settings.md`, new TDR in `docs/tdr/` and its README.
- No new dependency. No config key is added; the level lives in `memoryExtraParams`.
