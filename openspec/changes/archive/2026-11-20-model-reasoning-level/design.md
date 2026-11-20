# Design

## Context

See proposal.md for the motivation.

Current state, read from the code:

- `memoryExtraParams` goes into the request body as top-level members through `applySafeExtraParams` (`src/services/ai/providers/base-provider.ts`). The OpenAI Chat, OpenAI Responses and Anthropic Messages providers call it. So do AI Cleanup (`ai-cleanup.ts`), category cleanup (`category-cleanup-model.ts`), chat and the Test route (`settings-routes.ts`). One saved field therefore reaches every external API call with no new request code.
- Calls that use a host session model (OpenCode or Pi) go through the host. `src/adapters/` and `src/v2/` never read `memoryExtraParams`. This is why host reasoning is a non-goal.
- The backfill chooser (`HostSettings.tsx`, option **External API**) and the import chooser (`ImportSection.tsx`, option **Saved external API**) both use the saved external API. They have no model or endpoint of their own, so the control on the External API card covers them. The only other way to name an endpoint is the CLI `--api-url` flag, which is out of scope.
- The OpenRouter routing route writes `memoryExtraParams.provider` through `writeGlobalConfigKeys` with a nested key and a `derive` callback that reads the current file. `config-writer.ts` allows only `memoryExtraParams` and `memoryExtraParams.provider` as nested keys.
- `openrouter-models.ts` reads `GET https://openrouter.ai/api/v1/models` and keeps only `id` and `name`. The same reply carries `reasoning: { supported_efforts, default_effort, default_enabled, mandatory }`. On 2026-11-20, 477 models were listed: 360 had a reasoning object, 117 of those had no `supported_efforts`, and 151 were `mandatory`. The effort values seen were `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`.
- OpenRouter's reasoning guide: `effort: "none"` or `enabled: false` turns reasoning off; `enabled: true` reasons at medium effort; an effort the model lacks is mapped to the nearest one.
- `OpenRouterRouting.tsx` is 465 lines and `ExternalApiSection.tsx` is 440. The 500-line cap (`tests/file-size-ceiling.test.ts`) means new UI goes into new files.

## Goals / Non-Goals

**Goals:**

- One mapping table, used by the server (to write) and the page (to show choices and read the saved level).
- The server decides which field to write from the saved endpoint, so the field always matches what is saved.
- No new config key.

**Non-Goals:**

- Checking that the endpoint accepts the level before the save. The Test button already sends the saved field.
- Showing the level on any other card.

## Decisions

### 1. The mapping lives in `src/shared/model-reasoning.ts`

Pure functions, no imports outside `src/shared/`:

- `reasoningFamily(url, provider)` returns `openrouter` (host `openrouter.ai`), `deepseek` (host `api.deepseek.com`), `responses` (provider `openai-responses`), `chat` (provider `openai-chat`, any other host) or `none` (other providers).
- `reasoningChoices(family, facts?)` returns the levels to offer. For `openrouter` it reads the model facts; without facts (list missing, model not listed, or model listed with no reasoning object) it returns the general set (Default, Off, Low, Medium, High) and the card adds a note that OpenRouter uses the nearest level the model supports.
- `reasoningFields(family, level)` returns the one member to write, for example `{ reasoning: { effort: "low" } }`, or `{}` for Default.
- `savedLevel(family, extraParams)` returns the level, `"default"`, or `"custom"` for a value it cannot show.
- `ignoredReasoningField(family, extraParams)` returns `thinking` for `openrouter` and `reasoning` for `deepseek` when saved.

The web app imports it as `$shared` (it already does this for `hosts.ts`). Alternative: two copies, one per side. Rejected: the two could drift, which is how a wrong field gets saved.

Levels are one vocabulary: `default`, `off`, `on`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. OpenRouter's `none` shows as Off.

### 2. A separate save route, not the general settings save

`POST /api/settings/external-api/reasoning` with `{ revision, level }`, in a new `src/services/model-reasoning-routes.ts`, registered in `web-route-modules.ts`. Inside `derive`, it reads the current `memoryApiUrl` and `memoryProvider`, picks the family, refuses a level the family does not offer (Default is always allowed), and writes edits that delete `memoryExtraParams.reasoning`, `.reasoning_effort` and `.thinking` and set the new member. `config-writer.ts` accepts those three nested keys (object, string, or `undefined`). When `memoryExtraParams` is left empty it is removed, as `removeProviderEdits` does today.

The route does not check the level against OpenRouter's model facts. The page limits the choices, and OpenRouter maps an unsupported effort to the nearest one. A server check would need a network read inside a config write.

Alternative: send the level with the card's **Save settings**. Rejected: that save runs a test call first and writes plain keys. The level depends on the saved URL, so it is saved after the endpoint, like the routing.

### 3. The control is its own component with its own Save button

New `web/src/lib/components/settings/ReasoningLevel.tsx`, placed after the Model field on the External API card. It takes the saved URL, provider and model, the saved `memoryExtraParams` reasoning members from the snapshot (new `memoryReasoning` field in `settings-snapshot.ts`, holding only `reasoning`, `reasoning_effort` and `thinking`), and the model facts from `useOpenRouterModels`. Save is disabled with a reason while the card shows an unsaved URL, provider or model, following the routing block's `blockReason`. The hook's model type gains the optional facts.

### 4. Default level: Default (send nothing)

A fresh config and an existing config with no reasoning field both show Default, and nothing changes for them on upgrade. Alternative: default Low for OpenRouter to avoid the AI Cleanup timeout. Rejected: it would change cost and answer quality without the user's choice, and the root cause was a field in the wrong format, not a missing default. The ignored-field warning (spec: "The card warns about a reasoning field the endpoint ignores") points the user at the fix. A short note under the choice says that lower levels answer faster.

### 5. Let OpenRouter choose: the ticks are kept in page state only

Options considered:

1. Keep the ticks in page state. With the switch on, the save has no `order`, `only` or `allow_fallbacks`. **Chosen.**
2. Keep `order` with `allow_fallbacks: true`. Rejected: OpenRouter still tries the listed providers first, so it does not choose and the cheaper provider is not used.
3. Keep the ticks in a new OMMS config key. Rejected: a new key, its docs and its validation, to keep a list the user can tick again in seconds.

Effect: a reload after saving with the switch on shows the switch on and no ticks. The switch's load state comes from the saved object (on when a `provider` object exists without `order` and `only`). A saved `provider` that holds only privacy fields therefore loads with the switch on. That routing is the same as before: with no list, OpenRouter chooses.

`RoutingState` gains `openRouterChooses: boolean`. `providerFromRouting` drops `order`, `only` and `allow_fallbacks` when it is true. `routingFromProvider` sets it as above.

### 6. Ticked providers first: reorder on load and after save only

The pattern from AI Cleanup (commit `11b026b0`): a separate `orderIds` snapshot decides row order. It is set when the provider list arrives (from the saved ticks) and after a successful Save routing, then the list scrolls to its top. A tick changes `ticked` and the position badge, but not `orderIds`, so rows do not jump under the pointer. A pure `ticksFirst(rows, orderTicks)` in `web/src/lib/openrouter-routing.ts` does the sort; rows not ticked keep OpenRouter's order. Manual rows (slugs typed by hand) sort with the others by the same rule.

Alternative: reorder on every tick. Rejected: the row moves away from the pointer, and the next click can hit the wrong row.

### 7. File split

`ProviderRows`, `Blocked` and `useSixRowHeight` move from `OpenRouterRouting.tsx` to a new `OpenRouterProviderRows.tsx`. `Blocked` is exported so the switch and `ReasoningLevel.tsx` can use it. This frees about 170 lines for the switch.

### 8. A project `memoryExtraParams` keeps the global reasoning field

Today the project object replaces the global `memoryExtraParams`, except `provider` (`keepGlobalProvider`). The reasoning field depends on the global endpoint, so it follows the same rule. New `src/services/memory-extra-params-merge.ts` holds `keepGlobalReasoning` and `keepGlobalExtraParams` (calls `keepGlobalProvider`, then `keepGlobalReasoning`). `src/config.ts` calls `keepGlobalExtraParams` where it called `keepGlobalProvider`, so the file does not grow.

Rule: when the project sets `memoryExtraParams` and the project object holds none of `reasoning`, `reasoning_effort`, `thinking`, the global members of those three keys are copied in. When the project object holds any of the three, the project's reasoning fields win and no global reasoning field is copied (so a project `thinking` does not end up beside a global `reasoning`). A project with no `memoryExtraParams` already inherits the global object whole. Pure function, no `CONFIG` import. Alternative: always keep global and refuse a project value, as for `provider`. Rejected: a project may use a different effort on the same endpoint, and a checked-in project file cannot redirect memory text through a reasoning field.

## Risks / Trade-offs

- [A provider rejects an unknown `reasoning_effort` with an error instead of ignoring it] → The card shows the may-refuse note for the `chat` family. Default removes the field, and the Test button shows the failure.
- [OpenRouter changes the shape of the reasoning facts] → Facts are optional. A missing or malformed value falls back to the general choices.
- [The ticks are lost on reload while the switch is on] → Accepted (Decision 5). The docs say so.
- [A project config that sets `memoryExtraParams` could drop the global level in that project] → Decision 8 keeps it. A project that writes its own reasoning field replaces the global one.
- [The saved field no longer fits after the user switches endpoint] → The ignored-field warning covers the OpenRouter and DeepSeek cases. For other endpoints the card shows the level it can read, or Set in the config file.

## Migration Plan

No migration. Saved configs keep their fields. A user with a field in the wrong format sees the warning and saves a level to replace it. Rollback: revert the change; saved `reasoning`, `reasoning_effort` and `thinking` members stay valid `memoryExtraParams` members.
