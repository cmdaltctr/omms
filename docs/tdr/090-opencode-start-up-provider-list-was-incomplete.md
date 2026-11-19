# TDR-090: OpenCode's start-up provider list was incomplete

**Date:** 2026-11-19
**Status:** Proposed
**Deciders:** OMMS maintainers
**Tags:** opencode, providers, capture, profile-learning, import

## Context

With `opencodeModel: "inherit"`, OpenCode capture and profile learning logged `opencode provider '<provider>' is not connected`. They then used the external API and showed the "Using fallback provider" notice. The session itself ran on that provider. Two live runs showed this for `zai-coding-plan`, a provider that `opencode.json` and `auth.json` define.

### Root Cause Analysis

- The V2 plugin reads `ctx.model.list()` once at start (`startProviderWork` in `src/v2/startup.ts`). It keeps the provider ids in a set in `src/adapters/opencode/opencode-provider.ts`. OMMS did not read the list again.
- OpenCode fills its model list after start-up. Early reads can be empty or part of the list. On 2026-11-19, OpenCode 2.2.6 `--standalone` listed `openrouter`, `opencode`, `openai`, `cloudflare-ai-gateway`, `cloudflare-workers-ai`, `deepseek` and `ollama` at start. The list did not include `zai-coding-plan`, which the session used.
- Every check against the set then said "not connected" for that provider until OpenCode restarted.

## Decision

1. `confirmProviderConnected(providerID)` in `opencode-provider.ts` returns true when the set holds the provider. When the provider is missing, it reads `ctx.model.list()` again and adds the provider ids. It keeps only the ids, because each model record holds the provider's API key. It logs nothing.
2. These call sites use it before they fail or fall back:
   - Live capture: `src/adapters/opencode/auto-capture-summary.ts`.
   - Profile learning and the other profile calls: `src/adapters/opencode/profile-llm-client.ts`.
   - The in-session import command `/memory-import-opencode-history`: `src/adapters/opencode/import-command.ts`.
   - Single and grouped web imports: `src/importer/web-import-jobs.ts` and `src/importer/web-import-group.ts`, through the registry method `confirmProviderConnected` (`OpencodeHostModels` in `src/importer/backfill-controls.ts`, registered in `src/adapters/opencode/backfill-startup.ts`). The method is now async.
3. `src/services/ai/live-model-choice.ts` and the model choice order do not change.
4. `tests/opencode-late-provider-list.test.ts` runs the real V2 `setup` with a fake context whose first list read is empty. It covers each call site, and a provider that OpenCode never lists.

## Consequences

### Positive

- Capture, profile learning and imports use the session's provider as soon as OpenCode lists it.
- A provider that OpenCode does not list still falls back or fails with the same message as before.

### Negative

- A provider that OpenCode never lists costs one extra `ctx.model.list()` call at each check. The call runs in the same process.
- The set only grows. A provider that is removed while OpenCode runs still counts as connected. This was already true before this change.

### Neutral

- Pi has no such list. It looks up `ctx.modelRegistry` and `ctx.model` at each call.
- The automatic backfill and **Run now** on the Settings page still check the `connected` list from the start-up read (`resolveOpencodeBackfillModels` in `src/adapters/opencode/backfill-models.ts`).

## Alternatives Considered

| Option                                                  | Rejected Because                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Treat the session's own provider as connected (inherit) | It does not help an explicit `opencodeProvider` that loads late          |
| Poll the list at start until it stops changing          | No signal says when the list is complete, and it delays start-up         |
| Remove the connected check                              | An unlisted provider then fails later with a less clear model call error |

## How to Recognise / Handle This Again

1. Symptom: the log says `opencode provider '<id>' is not connected` or `OpenCode provider is not connected`, and the session runs on that provider.
2. Find the `opencode providers connected` line from start-up in the OMMS log. Check whether it lists the provider.
3. If the provider is missing at start but connected later, look for a check that reads the start-up list without `confirmProviderConnected`.

## Revisit Triggers

- OpenCode gives plugins a complete provider list at start, or an event when the list changes.
- The backfill `connected` list causes the same failure.

## References

- [TDR-014](./014-read-opencode-v2-models-over-http.md)
- `src/adapters/opencode/opencode-provider.ts`
- `tests/opencode-late-provider-list.test.ts`
