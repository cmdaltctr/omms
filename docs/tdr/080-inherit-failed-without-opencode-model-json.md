# TDR-080: `inherit` failed when OpenCode had no model.json

**Date:** 2026-11-11
**Status:** Proposed
**Deciders:** Aizat Hawari
**Tags:** opencode, profile-learning, model-choice

## Context

During the `drop-opencode-v1` live check, the first profile-learning run after a capture failed with "opencodeModel is 'inherit' but no session model was recorded and no recent OpenCode model is available". The check ran OpenCode headless (`opencode run` and `opencode serve`) in a scratch HOME.

### Root Cause Analysis (if debugging-driven)

With `opencodeModel: "inherit"`, a call that carries no prompt model (profile learning, profile clean-up, deduplication) resolves the model in `resolveOpencodeModelRef`. Its only fallback read `model.json` in OpenCode's state folder. Only the OpenCode TUI writes that file. Headless use (`opencode run`, `opencode serve`, OpenChamber) leaves it missing, so those calls failed although the `context` hook had seen the session model on every model request.

## Decision

The `context` hook remembers the model of the latest model request (`rememberOpencodeSessionModel` in `src/adapters/opencode/opencode-host.ts`, called from `recordOpencodePromptModel`). `inherit` now resolves in this order:

1. The prompt's recorded model.
2. The latest model request this plugin saw.
3. The most recent entry in `model.json`.

The value lives in memory only. It holds no store handle, so a memory space switch does not need to reset it.

## Consequences

### Positive

- Profile learning, clean-up and deduplication work in headless OpenCode.
- `inherit` follows the model the user runs now, not the last one picked in the TUI.

### Negative

- Before the first model request of a process, the plugin has no session model, so the call still falls back to `model.json` or fails. Profile learning runs after a capture, so a request always comes first.

### Neutral

- The prompt-row write keeps its rule: the row is written only while live calls follow the session model.

## Alternatives Considered

| Option                                                    | Rejected Because                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Use OpenCode's default model (`ctx.model.default()`)      | It is the configured default, not the model the user runs in this session; it also needs an async call in a sync resolver. |
| Read the newest prompt row's model from `user-prompts.db` | A database read for a value the plugin already saw in memory.                                                              |

## How to Recognise / Handle This Again

The log shows "opencodeModel is 'inherit' but no session model was recorded" from `user-profile-learning`, and the OpenCode state folder has no `model.json`.

## Revisit Triggers

- OpenCode adds a plugin API that returns the current session model.

## References

- `src/adapters/opencode/opencode-provider.ts` (`resolveOpencodeModelRef`)
- `src/adapters/opencode/prompt-model.ts`, `src/adapters/opencode/opencode-host.ts`
- `tests/opencode-provider.test.ts`, `tests/v2-session-events.test.ts`
