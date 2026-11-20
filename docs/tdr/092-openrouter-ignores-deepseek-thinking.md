# TDR-092: OpenRouter ignores DeepSeek's thinking field

**Date:** 2026-11-20
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** ai-cleanup, openrouter, reasoning, memoryExtraParams

## Context

AI Cleanup sends each batch to the external API with a 60 second limit (see [TDR-051](./051-ai-cleanup-timeout-on-large-selections.md)). On 2026-11-20, 15 of 16 batches timed out. The saved config sent the calls to OpenRouter.

### Root Cause Analysis

The saved `memoryExtraParams` held `thinking: { type: "disabled" }`. That is DeepSeek's own format. OpenRouter does not read `thinking`. It reads `reasoning`. It ignored the field, so the model reasoned at its `default_effort`, which is `high`. Every batch ran long and passed 60 seconds.

Each endpoint has its own reasoning field. The user had to know the field and type it into the config file. Nothing told the user that the field did not fit the endpoint.

## Decision

The External API card gets a **Reasoning level** control (OpenSpec change `model-reasoning-level`). The server writes the field that the saved endpoint reads:

| Endpoint                      | Field written                                 |
| ----------------------------- | --------------------------------------------- |
| OpenRouter (`openrouter.ai`)  | `reasoning: { effort }`, `"none"` for Off     |
| DeepSeek (`api.deepseek.com`) | `thinking: { type: "enabled" \| "disabled" }` |
| OpenAI Responses provider     | `reasoning: { effort }`                       |
| Other OpenAI Chat endpoint    | `reasoning_effort`                            |

A level save replaces `reasoning`, `reasoning_effort` and `thinking`, and keeps the other `memoryExtraParams` members. The card warns when `thinking` is saved for OpenRouter, or `reasoning` for DeepSeek. A project config that sets `memoryExtraParams` keeps the global reasoning field, as it keeps `provider`.

Default sends no field. The fix does not change the model's own reasoning. The user chooses the level.

## Consequences

### Positive

- The field always matches the saved endpoint.
- A field that the endpoint ignores shows a warning with the fix.

### Negative

- A provider can refuse an unknown `reasoning_effort`. The card says so for the generic OpenAI Chat family.

### Neutral

- No config key is added. The level lives in `memoryExtraParams`.

## Alternatives Considered

| Option                                       | Rejected Because                                              |
| -------------------------------------------- | ------------------------------------------------------------- |
| Default to Low on OpenRouter                 | It changes cost and answer quality without the user's choice. |
| Raise the 60 second limit                    | It hides the slow reasoning. Every batch still costs more.    |
| Document the field and keep the file by hand | The mistake was already made once with the docs in place.     |

## How to Recognise / Handle This Again

1. AI Cleanup batches time out, and the model is a reasoning model on OpenRouter.
2. Open **Settings**, **External API**. Look for the warning that OpenRouter ignores `thinking`.
3. Pick a **Reasoning level** (Low or Off) and select **Save reasoning level**.

## Revisit Triggers

- OpenRouter reads `thinking`, or changes the shape of the `reasoning` object.
- A new endpoint family needs its own field.

## References

- [TDR-051](./051-ai-cleanup-timeout-on-large-selections.md)
- `openspec/changes/model-reasoning-level/`
- `src/shared/model-reasoning.ts`
- `tests/model-reasoning.test.ts`, `tests/model-reasoning-route.test.ts`
